import { AssumeRoleCommand, type STSClient } from '@aws-sdk/client-sts';
import { AssumeRoleFailedError } from '../errors.js';
import type { Creds } from './client-factory.js';

export interface AssumeRoleRequest {
  roleArn: string;
  externalId: string;
  sessionName: string;
  durationSeconds?: number;
}

export interface AssumeRoleCacheOpts {
  stsClient: STSClient;
  ttlSkewSeconds?: number;
}

interface CachedEntry {
  creds: Creds;
  expiresAt: number;
}

export function createAssumeRoleCache(opts: AssumeRoleCacheOpts) {
  const skew = (opts.ttlSkewSeconds ?? 30) * 1000;
  const map = new Map<string, CachedEntry>();

  function key(req: AssumeRoleRequest): string {
    return `${req.roleArn}|${req.externalId}`;
  }

  async function assume(req: AssumeRoleRequest): Promise<Creds> {
    const k = key(req);
    const now = Date.now();
    const cached = map.get(k);
    if (cached && cached.expiresAt - now > skew) {
      return cached.creds;
    }

    try {
      const out = await opts.stsClient.send(
        new AssumeRoleCommand({
          RoleArn: req.roleArn,
          ExternalId: req.externalId,
          RoleSessionName: req.sessionName,
          DurationSeconds: req.durationSeconds ?? 3600,
        }),
      );

      const c = out.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) {
        throw new AssumeRoleFailedError(req.roleArn, 'incomplete STS response');
      }

      const creds: Creds = {
        accessKeyId: c.AccessKeyId,
        secretAccessKey: c.SecretAccessKey,
        sessionToken: c.SessionToken,
      };

      map.set(k, { creds, expiresAt: c.Expiration.getTime() });
      return creds;
    } catch (err) {
      if (err instanceof AssumeRoleFailedError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new AssumeRoleFailedError(req.roleArn, reason);
    }
  }

  return { assume };
}
