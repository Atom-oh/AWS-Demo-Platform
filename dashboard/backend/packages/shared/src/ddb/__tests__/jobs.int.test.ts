import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { makeClient } from '../../aws/client-factory.js';
import { ensureJobsTable } from './setup-localstack.js';
import { JobsClient } from '../jobs.js';

const TABLE = 'test-jobs';

describe('JobsClient (integration)', () => {
  let doc: DynamoDBDocumentClient;
  let client: JobsClient;

  beforeAll(async () => {
    process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    const raw = makeClient(DynamoDBClient, { region: 'ap-northeast-2' });
    await ensureJobsTable(raw, TABLE);
    doc = DynamoDBDocumentClient.from(raw);
    client = new JobsClient({ doc, tableName: TABLE });
  });

  afterAll(() => doc.destroy());

  it('creates and reads a job', async () => {
    const id = await client.create({ repo: 'foo/bar', operation: 'turn_off' });
    const rec = await client.read(id);
    expect(rec?.status).toBe('pending');
    expect(rec?.gsi1pk).toBe('project#foo/bar');
  });

  it('updates status transitions', async () => {
    const id = await client.create({ repo: 'r', operation: 'turn_on' });
    await client.markRunning(id);
    await client.appendProgress(id, 'ecs', 'done');
    await client.markSucceeded(id);
    const rec = await client.read(id);
    expect(rec?.status).toBe('succeeded');
    expect(rec?.progress.ecs).toBe('done');
    expect(rec?.completed_at).toBeDefined();
  });

  it('lists running jobs for sweep', async () => {
    const id = await client.create({ repo: 'sweep', operation: 'turn_off' });
    await client.markRunning(id);
    const running = await client.listRunning();
    expect(running.find((j) => j.pk === `job#${id}`)?.status).toBe('running');
  });

  it('markFailed sets error and status', async () => {
    const id = await client.create({ repo: 'r', operation: 'turn_off' });
    await client.markRunning(id);
    await client.markFailed(id, 'boom');
    const rec = await client.read(id);
    expect(rec?.status).toBe('failed');
    expect(rec?.error).toBe('boom');
  });
});
