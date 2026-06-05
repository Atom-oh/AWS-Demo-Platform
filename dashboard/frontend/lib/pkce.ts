// PKCE + base64url helpers using the Web Crypto API (no deps). Browser-only.

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(byteLen = 48): string {
  const a = new Uint8Array(byteLen);
  crypto.getRandomValues(a);
  return base64url(a);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function decodeJwtPayload(jwt: string | null): Record<string, unknown> {
  if (!jwt) return {};
  try {
    const part = jwt.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
