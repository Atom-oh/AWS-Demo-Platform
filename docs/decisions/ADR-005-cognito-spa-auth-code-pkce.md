# ADR-005: Cognito Hosted-UI Authorization Code + PKCE for the dashboard SPA

## Status
Accepted (Stage 3, 2026-06-04)

## Context

The dashboard at `admin-dev.atomai.click` is publicly reachable (CloudFront) and
the api is fail-closed Cognito-JWT. The single-admin SPA needs a browser login
flow, and we must decide three things: the OAuth flow for a public client (no
secret), which token to send to the api, and where to keep tokens.

```mermaid
flowchart LR
  U[Browser SPA] -->|1 login| H[Cognito Hosted UI]
  H -->|2 code + state| CB[/auth/callback/]
  CB -->|3 code + PKCE verifier| T[Cognito /oauth2/token]
  T -->|access + id + refresh| U
  U -->|4 Bearer ACCESS token| API[api /api/* - fail-closed JWT]
```

## Options Considered

### Option 1: Implicit flow (tokens returned in the redirect fragment)
- **Pros**: no token-exchange step.
- **Cons**: deprecated for SPAs; access/id tokens land in the URL/history; no refresh token.

### Option 2: Authorization Code + PKCE (public client)
- **Pros**: the current standard for SPAs; the code is exchanged client-side using a PKCE verifier (no client secret); yields a refresh token for silent renewal.
- **Cons**: needs a callback route, a code-exchange step, and explicit token-storage handling.

### Token storage sub-decision: httpOnly-cookie BFF vs in-memory + sessionStorage
- **BFF (httpOnly cookie)**: not XSS-readable, but needs a Next server-side proxy holding tokens.
- **In-memory + sessionStorage**: simplest; access/id in memory, refresh in sessionStorage; XSS-exposed.

## Decision

**Authorization Code + PKCE.** The `dashboard-dev` app client is
`generate_secret = false`, `allowed_oauth_flows = ["code"]`. Flow: login → Hosted
UI → `/auth/callback` exchanges the code (with the PKCE verifier and a `state`
CSRF check) → tokens. The SPA sends the **access** token as
`Authorization: Bearer` — the api verifies `tokenUse:'access'` + `clientId` and
checks the verified access token's `username` against `ADMIN_USERNAMES`.
The verifier adapter maps `username` to the plugin's internal
`cognito:username` field; that internal name is not the access-token claim name.
The ID token is used for display, not API authorization.
Access/id tokens live in memory; the refresh token is kept in `sessionStorage` for
reload survival, with a silent refresh ~60s before expiry.
`NEXT_PUBLIC_AUTH_ENABLED=false` bypasses the frontend login UI only.
For a single-admin non-prod tool we accept in-memory + sessionStorage over a BFF.

## Consequences

### Positive
- Standard, secret-less SPA auth; the access token matches exactly what the api verifier expects.
- The dev bypass keeps local development tokenless against the dev-server.

### Negative
- Tokens are XSS-exposed (documented; a cookie BFF is a future tightening).
- `NEXT_PUBLIC_*` are inlined at build time, so the prod image must be built with the prod Cognito values (client id, redirect/logout URIs, `AUTH_ENABLED=true`).
- Sending the wrong token type (ID instead of access) produces 401.

## Current applicability (2026-09-13)

The production verifier validates the configured user pool, client and access-token
use before the allowlist check. `/health` is exempt. Missing/invalid credentials
return 401; a verified non-admin returns 403. Plugin tests inject an already-adapted
fake verifier, so they do not validate the real Cognito claim adapter.

The API entry point sets `skipJwt` only for literal `NODE_ENV=development`.
All other values, including unset, enforce JWT; deployed dev tasks explicitly use
`NODE_ENV=production`. The separate local dev-server injects `skipJwt: true`.
Changing the frontend flag cannot relax server authorization.

The frontend flag defaults to enabled, and `NEXT_PUBLIC_*` configuration is
inlined at build time. CI builds the deployed **dev** Cognito configuration;
its production-mode image is not a separate production environment.
Refresh failure clears tokens and returns the UI to anonymous state.
Cookie BFF/token-storage hardening remains unimplemented.

## References

- [OAuth functions](../../dashboard/frontend/lib/auth.ts),
  [token store](../../dashboard/frontend/lib/token-store.ts),
  [auth provider](../../dashboard/frontend/components/AuthProvider.tsx)
- [Verifier/plugin](../../dashboard/backend/packages/api/src/plugins/jwt-cognito.ts),
  [entry point](../../dashboard/backend/packages/api/src/server.ts),
  [plugin tests](../../dashboard/backend/packages/api/src/__tests__/jwt-cognito.test.ts)
- [Cognito configuration](../../infra/cognito/main.tf),
  [frontend CI build arguments](../../.github/workflows/frontend-ci.yml); PR #19
