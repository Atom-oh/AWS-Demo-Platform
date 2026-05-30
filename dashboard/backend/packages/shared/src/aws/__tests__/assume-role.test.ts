import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { createAssumeRoleCache } from '../assume-role.js';

const stsMock = mockClient(STSClient);

beforeEach(() => {
  stsMock.reset();
});

describe('createAssumeRoleCache', () => {
  it('calls STS once for a given role+externalId pair within ttl', async () => {
    stsMock.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: 'AKIA',
        SecretAccessKey: 'sec',
        SessionToken: 'tok',
        Expiration: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const cache = createAssumeRoleCache({
      stsClient: stsMock as unknown as STSClient,
      ttlSkewSeconds: 30,
    });

    const c1 = await cache.assume({
      roleArn: 'arn:aws:iam::123456789012:role/Op',
      externalId: 'eid-1',
      sessionName: 'test',
    });
    const c2 = await cache.assume({
      roleArn: 'arn:aws:iam::123456789012:role/Op',
      externalId: 'eid-1',
      sessionName: 'test',
    });

    expect(c1).toEqual(c2);
    expect(stsMock.commandCalls(AssumeRoleCommand)).toHaveLength(1);
  });

  it('refreshes when expiration approaches (within skew window)', async () => {
    stsMock
      .on(AssumeRoleCommand)
      .resolvesOnce({
        Credentials: {
          AccessKeyId: 'AKIA1',
          SecretAccessKey: 'sec',
          SessionToken: 'tok1',
          Expiration: new Date(Date.now() + 20 * 1000), // 20s — inside skew
        },
      })
      .resolvesOnce({
        Credentials: {
          AccessKeyId: 'AKIA2',
          SecretAccessKey: 'sec',
          SessionToken: 'tok2',
          Expiration: new Date(Date.now() + 3600 * 1000),
        },
      });

    const cache = createAssumeRoleCache({
      stsClient: stsMock as unknown as STSClient,
      ttlSkewSeconds: 30,
    });

    const c1 = await cache.assume({
      roleArn: 'arn:aws:iam::1:role/X',
      externalId: 'e',
      sessionName: 's',
    });
    const c2 = await cache.assume({
      roleArn: 'arn:aws:iam::1:role/X',
      externalId: 'e',
      sessionName: 's',
    });

    expect(c1.accessKeyId).toBe('AKIA1');
    expect(c2.accessKeyId).toBe('AKIA2');
  });

  it('throws AssumeRoleFailedError on STS rejection', async () => {
    stsMock.on(AssumeRoleCommand).rejects(
      Object.assign(new Error('Access denied'), { name: 'AccessDenied' }),
    );

    const cache = createAssumeRoleCache({
      stsClient: stsMock as unknown as STSClient,
      ttlSkewSeconds: 30,
    });

    await expect(
      cache.assume({
        roleArn: 'arn:aws:iam::1:role/Bad',
        externalId: 'e',
        sessionName: 's',
      }),
    ).rejects.toThrow(/AssumeRole failed/);
  });
});
