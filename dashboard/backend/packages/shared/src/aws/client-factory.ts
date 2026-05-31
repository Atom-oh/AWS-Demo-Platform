import { baseRetryConfig } from './retry-config.js';

export interface Creds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface ClientOpts {
  region: string;
  endpoint?: string;
}

export interface ClientOptsWithCreds extends ClientOpts {
  credentials: Creds;
}

type AwsClientCtor<T> = new (config: Record<string, unknown>) => T;

/**
 * Resolve the endpoint, honoring an explicit override or AWS_ENDPOINT_URL
 * (LocalStack) — but NEVER in production, where a stray AWS_ENDPOINT_URL would
 * silently redirect every AWS call away from the real services.
 */
function resolveEndpoint(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (process.env.NODE_ENV === 'production') return undefined;
  return process.env.AWS_ENDPOINT_URL;
}

export function makeClient<T>(
  Ctor: AwsClientCtor<T>,
  opts: ClientOpts,
): T {
  return new Ctor({
    region: opts.region,
    endpoint: resolveEndpoint(opts.endpoint),
    ...baseRetryConfig,
  });
}

export function makeClientWithCreds<T>(
  Ctor: AwsClientCtor<T>,
  opts: ClientOptsWithCreds,
): T {
  return new Ctor({
    region: opts.region,
    endpoint: resolveEndpoint(opts.endpoint),
    credentials: async () => opts.credentials,
    ...baseRetryConfig,
  });
}
