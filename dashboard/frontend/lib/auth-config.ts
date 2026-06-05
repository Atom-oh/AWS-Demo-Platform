// OAuth/Cognito config. NEXT_PUBLIC_* are inlined into the client bundle at
// BUILD time (the Docker image must be built with the prod values). Local dev
// against the dev-server sets NEXT_PUBLIC_AUTH_ENABLED=false to skip login,
// mirroring the api's skipJwt.
export const authConfig = {
  region: process.env.NEXT_PUBLIC_COGNITO_REGION ?? 'ap-northeast-2',
  domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? '',
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
  redirectUri: process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI ?? '',
  logoutUri: process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI ?? '',
  scope: 'openid email profile',
};

// Auth is on unless explicitly disabled. Undefined (unset) => enabled.
export const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'false';

export const authorizeUrl = `https://${authConfig.domain}/oauth2/authorize`;
export const tokenUrl = `https://${authConfig.domain}/oauth2/token`;
export const logoutUrl = `https://${authConfig.domain}/logout`;
