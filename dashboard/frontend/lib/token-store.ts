// Single source of truth for tokens. access_token + id_token live in MEMORY
// only (cleared on reload); refresh_token persists in sessionStorage so a reload
// can silently re-mint an access token. lib/api.ts reads getAccessToken().
import { decodeJwtPayload } from './pkce';

export interface Tokens {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
}

const REFRESH_KEY = 'cognito_refresh';

let accessToken: string | null = null;
let accessExp = 0; // epoch seconds
let idToken: string | null = null;

export function setTokens(t: Tokens): void {
  accessToken = t.access_token;
  const exp = decodeJwtPayload(t.access_token)['exp'];
  accessExp = typeof exp === 'number' ? exp : 0;
  if (t.id_token) idToken = t.id_token;
  if (t.refresh_token && typeof window !== 'undefined') {
    sessionStorage.setItem(REFRESH_KEY, t.refresh_token);
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getAccessExp(): number {
  return accessExp;
}

export function getIdToken(): string | null {
  return idToken;
}

export function getRefreshToken(): string | null {
  return typeof window !== 'undefined' ? sessionStorage.getItem(REFRESH_KEY) : null;
}

export function clearTokens(): void {
  accessToken = null;
  accessExp = 0;
  idToken = null;
  if (typeof window !== 'undefined') sessionStorage.removeItem(REFRESH_KEY);
}
