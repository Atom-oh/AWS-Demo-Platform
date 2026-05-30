import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { runOnce, sweepRunningJobs } from '../poll-loop.js';

const sqsMock = mockClient(SQSClient);
beforeEach(() => sqsMock.reset());

const baseProject = {
  name: 'p',
  github: { repo: 'foo/bar', branch: 'main' },
  account: 'atomoh-main',
  resources: [{ type: 'ecs' as const, cluster: 'c', service: 's' }],
};

const account = {
  name: 'atomoh-main',
  account_id: '111111111111',
  region: 'ap-northeast-2',
  roles: {
    operator: { arn: 'arn:aws:iam::111111111111:role/Op', external_id_secret: '/demo-platform/external-ids/atomoh-main/operator' },
    terraformer: { arn: 'arn:aws:iam::111111111111:role/Tf', external_id_secret: '/demo-platform/external-ids/atomoh-main/terraformer' },
  },
};

describe('runOnce', () => {
  it('processes a message: read project, run job, delete message', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({
      Messages: [
        {
          MessageId: 'm1',
          ReceiptHandle: 'h1',
          Body: JSON.stringify({ jobId: 'j1', repo: 'foo/bar', operation: 'turn_off' }),
        },
      ],
    });
    sqsMock.on(DeleteMessageCommand).resolves({});

    const runJobSpy = vi.fn(async () => undefined);
    const ctx = {
      sqsClient: sqsMock as unknown as SQSClient,
      queueUrl: 'http://q',
      waitSeconds: 0,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      projectByRepo: { 'foo/bar': baseProject },
      accountsByName: { 'atomoh-main': account },
      runJob: runJobSpy,
      buildControllers: vi.fn(async () => ({} as never)),
    };
    const processed = await runOnce(ctx as never);
    expect(processed).toBe(true);
    expect(runJobSpy).toHaveBeenCalled();
    expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(1);
  });

  it('returns false when no messages', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({ Messages: [] });
    const ctx = {
      sqsClient: sqsMock as unknown as SQSClient,
      queueUrl: 'http://q',
      waitSeconds: 0,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      projectByRepo: {},
      accountsByName: {},
      runJob: vi.fn(),
      buildControllers: vi.fn(),
    };
    expect(await runOnce(ctx as never)).toBe(false);
  });

  it('skips and logs error if project unknown', async () => {
    sqsMock.on(ReceiveMessageCommand).resolves({
      Messages: [
        {
          MessageId: 'm',
          ReceiptHandle: 'h',
          Body: JSON.stringify({ jobId: 'j', repo: 'unknown/repo', operation: 'turn_off' }),
        },
      ],
    });
    sqsMock.on(DeleteMessageCommand).resolves({});
    const errors: unknown[] = [];
    const ctx = {
      sqsClient: sqsMock as unknown as SQSClient,
      queueUrl: 'http://q',
      waitSeconds: 0,
      logger: { info: () => {}, warn: () => {}, error: (o: unknown) => errors.push(o), debug: () => {} },
      projectByRepo: {},
      accountsByName: {},
      runJob: vi.fn(),
      buildControllers: vi.fn(),
    };
    expect(await runOnce(ctx as never)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('sweepRunningJobs', () => {
  it('re-enqueues found running jobs', async () => {
    const jobs = [
      {
        pk: 'job#j1',
        gsi1pk: 'project#foo/bar',
        gsi1sk: 't',
        operation: 'turn_off' as const,
        status: 'running' as const,
        progress: {},
        created_at: 't',
        ttl: 1,
      },
    ];
    const jobsClient = { listRunning: vi.fn(async () => jobs) };
    const sentMessages: string[] = [];
    const sqs = {
      send: vi.fn(async (cmd: { input?: { MessageBody?: string } }) => {
        sentMessages.push(cmd.input?.MessageBody ?? '');
      }),
    };
    await sweepRunningJobs({
      sqsClient: sqs as unknown as SQSClient,
      queueUrl: 'http://q',
      jobsClient: jobsClient as never,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    });
    expect(sentMessages).toHaveLength(1);
    expect(JSON.parse(sentMessages[0])).toMatchObject({ jobId: 'j1', repo: 'foo/bar', operation: 'turn_off' });
  });
});
