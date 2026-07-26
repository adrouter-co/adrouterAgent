import { join } from 'node:path';
import { app, BrowserWindow, session, shell } from 'electron';
import { isSafeExternalUrl } from '../shared/security';
import { registerAppProtocol, rendererUrl } from './app-protocol';
import { ConfigurationStore } from './configuration-store';
import { AppDatabase } from './database';
import { type EventSubscriptions, registerIpcHandlers } from './ipc';
import { RepositoryService } from './repository-service';
import { ReviewService } from './review-service';
import { RuntimeSupervisor } from './runtime-supervisor';

app.setName('AdRouter Agent');

let database: AppDatabase | undefined;

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1_480,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#0f172a',
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl !== rendererUrl) {
      event.preventDefault();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      setImmediate(() => void shell.openExternal(url));
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  if (app.isPackaged) {
    window.webContents.on('devtools-opened', () => window.webContents.closeDevTools());
  }
  void window.loadURL(rendererUrl);
  return window;
};

const initializeApplication = (): void => {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  const rendererRoot = join(__dirname, '..', 'renderer', MAIN_WINDOW_VITE_NAME);
  registerAppProtocol(rendererRoot);

  const userData = app.getPath('userData');
  database = new AppDatabase(join(userData, 'adrouter.sqlite'));
  database.recoverInterruptedRuns();
  const configuration = new ConfigurationStore(join(userData, 'configuration.json'));
  const repositories = new RepositoryService(database);
  const review = new ReviewService(database);
  let subscriptions: EventSubscriptions | undefined;
  const supervisor = new RuntimeSupervisor(database, join(__dirname, 'runtime.js'), (event) =>
    subscriptions?.publish(event)
  );
  subscriptions = registerIpcHandlers({
    database,
    configuration,
    repositories,
    review,
    supervisor,
  });

  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
};

void app
  .whenReady()
  .then(initializeApplication)
  .catch((error: unknown) => {
    console.error('AdRouter Agent failed to initialize.', error);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  database?.close();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
