// Pure OAuth2 Authorization Code + PKCE functions (no React). Public SPA client
// (no secret). The api verifies the Cognito ACCESS token, so that is what we
// send as Bearer (see lib/api.ts); the id_token is only for displaying the user.
'use client';
import { authConfig, authorizeUrl, tokenUrl, logoutUrl } from './auth-config';
import { randomString, pkceChallenge } from './pkce';
import type { Tokens } from './token-store';

const VERIFIER_KEY = 'pkce_verifier';
const STATE_KEY = 'oauth_state';

export async function login(): Promise<void> {
  const verifier = randomString(48);
  const state = randomString(16);
  const challenge = await pkceChallenge(verifier);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: authConfig.clientId,
    redirect_uri: authConfig.redirectUri,
    scope: authConfig.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  window.location.assign(`${authorizeUrl}?${params.toString()}`);
}

async function postToken(body: URLSearchParams): Promise<Tokens> {
  const r = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`token endpoint ${r.status}`);
  return (await r.json()) as Tokens;
}

export function exchangeCodeForTokens(code: string): Promise<Tokens> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error('missing PKCE verifier');
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: authConfig.clientId,
      redirect_uri: authConfig.redirectUri,
      code,
      code_verifier: verifier,
    }),
  );
}

export function refreshTokens(refreshToken: string): Promise<Tokens> {
  // Cognito does NOT return a new refresh_token on refresh; keep the existing one.
  return postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: authConfig.clientId,
      refresh_token: refreshToken,
    }),
  );
}

export function readState(): string | null {
  return sessionStorage.getItem(STATE_KEY);
}

export function clearPkce(): void {
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
}

export function logoutRedirect(): void {
  const params = new URLSearchParams({
    client_id: authConfig.clientId,
    logout_uri: authConfig.logoutUri,
  });
  window.location.assign(`${logoutUrl}?${params.toString()}`);
}
