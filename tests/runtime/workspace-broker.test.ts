import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteBoundWorkspaceFile,
  inspectWorkspacePath,
  listBoundWorkspaceFiles,
  readBoundWorkspaceFile,
  replaceBoundWorkspaceFile,
} from '@/runtime/workspace-broker';

const directories: string[] = [];

const temporaryDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('descriptor-bound workspace broker', () => {
  it('binds regular-file reads, replacements, listings, and deletes to the workspace', async () => {
    const root = await temporaryDirectory('adrouter-workspace-broker-');
    await writeFile(join(root, 'source.txt'), 'before\n');

    expect(inspectWorkspacePath(root, 'source.txt')).toMatchObject({ kind: 'file', size: 7 });
    expect(readBoundWorkspaceFile(root, 'source.txt', 64).toString('utf8')).toBe('before\n');
    replaceBoundWorkspaceFile(root, 'source.txt', Buffer.from('before\n'), Buffer.from('after\n'));
    replaceBoundWorkspaceFile(root, 'nested/new.txt', null, Buffer.from('created\n'));
    expect(listBoundWorkspaceFiles(root, '.', 10)).toEqual({
      files: ['nested/new.txt', 'source.txt'],
      truncated: false,
      rejected: false,
    });
    deleteBoundWorkspaceFile(root, 'source.txt', Buffer.from('after\n'));
    expect(inspectWorkspacePath(root, 'source.txt').kind).toBe('missing');
    await expect(readFile(join(root, 'nested/new.txt'), 'utf8')).resolves.toBe('created\n');
  });

  it('rejects symbolic links and hard-linked files', async () => {
    const root = await temporaryDirectory('adrouter-workspace-broker-');
    const outside = await temporaryDirectory('adrouter-workspace-outside-');
    await writeFile(join(outside, 'secret.txt'), 'outside-secret\n');

    if (process.platform !== 'win32') {
      await symlink(join(outside, 'secret.txt'), join(root, 'linked.txt'));
      expect(() => readBoundWorkspaceFile(root, 'linked.txt', 64)).toThrow(/symbolic|safely/i);
    }

    await link(join(outside, 'secret.txt'), join(root, 'hard-linked.txt'));
    expect(() => readBoundWorkspaceFile(root, 'hard-linked.txt', 64)).toThrow(/hard-linked/i);
    expect(listBoundWorkspaceFiles(root, '.', 10).rejected).toBe(true);
  });

  it.runIf(process.platform !== 'win32')(
    'never follows an outside symlink substituted during a directory race',
    async () => {
      const root = await temporaryDirectory('adrouter-workspace-broker-');
      const outside = await temporaryDirectory('adrouter-workspace-outside-');
      await mkdir(join(root, 'swap'));
      await writeFile(join(root, 'swap', 'value.txt'), 'inside\n');
      await writeFile(join(outside, 'value.txt'), 'outside-secret\n');

      const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2));
      const worker = new Worker(
        `
          const fs = require('node:fs');
          const { workerData } = require('node:worker_threads');
          const state = new Int32Array(workerData.state);
          const swap = workerData.swap;
          const held = workerData.held;
          try {
            Atomics.store(state, 0, 1);
            while (Atomics.load(state, 1) === 0) {
              fs.renameSync(swap, held);
              fs.symlinkSync(workerData.outside, swap, 'dir');
              fs.unlinkSync(swap);
              fs.renameSync(held, swap);
            }
          } finally {
            try {
              if (fs.lstatSync(swap).isSymbolicLink()) fs.unlinkSync(swap);
            } catch {}
            try {
              if (!fs.existsSync(swap) && fs.existsSync(held)) fs.renameSync(held, swap);
            } catch {}
          }
        `,
        {
          eval: true,
          workerData: {
            state: state.buffer,
            swap: join(root, 'swap'),
            held: join(root, 'held'),
            outside,
          },
        }
      );

      while (Atomics.load(state, 0) === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      try {
        for (let attempt = 0; attempt < 2_000; attempt += 1) {
          let value: string | undefined;
          try {
            value = readBoundWorkspaceFile(root, 'swap/value.txt', 64).toString('utf8');
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
          }
          if (value !== undefined) expect(value).toBe('inside\n');
        }
      } finally {
        Atomics.store(state, 1, 1);
        Atomics.notify(state, 1);
        await new Promise<void>((resolve, reject) => {
          worker.once('exit', (code) =>
            code === 0 ? resolve() : reject(new Error(`worker ${code}`))
          );
          worker.once('error', reject);
        });
      }
    }
  );
});
