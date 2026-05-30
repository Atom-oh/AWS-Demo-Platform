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

export function makeClient<T>(
  Ctor: AwsClientCtor<T>,
  opts: ClientOpts,
): T {
  const endpoint = opts.endpoint ?? process.env.AWS_ENDPOINT_URL;
  return new Ctor({
    region: opts.region,
    endpoint,
    ...baseRetryConfig,
  });
}

export function makeClientWithCreds<T>(
  Ctor: AwsClientCtor<T>,
  opts: ClientOptsWithCreds,
): T {
  const endpoint = opts.endpoint ?? process.env.AWS_ENDPOINT_URL;
  return new Ctor({
    region: opts.region,
    endpoint,
    credentials: async () => opts.credentials,
    ...baseRetryConfig,
  });
}
