export const DEFAULT_ADROUTER_SERVER_URL = 'https://api-staging.adrouter.co';

export const OFFICIAL_ADROUTER_ORIGINS = [
  'https://api.adrouter.co',
  'https://api-staging.adrouter.co',
] as const;
export const OFFICIAL_ADROUTER_WEB_ORIGINS = [
  'https://app.adrouter.co',
  'https://app-staging.adrouter.co',
] as const;

export const DESKTOP_CLIENT_KIND = 'desktop' as const;
export const INSTALLATION_AUTH_PROTOCOL_VERSION = 1 as const;
export const MAX_SIGNED_REQUEST_BYTES = 2 * 1024 * 1024;

export type RouterOriginClass = 'official' | 'loopback' | 'custom';

export const classifyRouterOrigin = (value: string): RouterOriginClass => {
  const url = new URL(value);
  if ((OFFICIAL_ADROUTER_ORIGINS as readonly string[]).includes(url.origin)) return 'official';
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
    return 'loopback';
  }
  return 'custom';
};
