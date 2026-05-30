import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { makeClient } from '../../aws/client-factory.js';
import { ensureStateTable } from './setup-localstack.js';
import { StateClient } from '../state.js';
import { ConflictError } from '../../errors.js';

const TABLE = 'test-state';

describe('StateClient (integration, LocalStack)', () => {
  let doc: DynamoDBDocumentClient;
  let client: StateClient;

  beforeAll(async () => {
    process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    const raw = makeClient(DynamoDBClient, { region: 'ap-northeast-2' });
    await ensureStateTable(raw, TABLE);
    doc = DynamoDBDocumentClient.from(raw);
    client = new StateClient({ doc, tableName: TABLE });
  });

  afterAll(async () => {
    doc.destroy();
  });

  it('reads non-existent key as null', async () => {
    expect(await client.read('not-here')).toBeNull();
  });

  it('writes initial state and reads it back', async () => {
    await client.upsertInitial('proj-a');
    const rec = await client.read('proj-a');
    expect(rec?.status).toBe('on');
  });

  it('transitions on → transitioning → off (with restoration_data)', async () => {
    await client.upsertInitial('proj-b');
    await client.transition('proj-b', { from: 'on', to: 'transitioning', actor: 'atomoh' });
    await client.markOff('proj-b', { restoration_data: { ecs: { original_desired_count: 2 } } });
    const r = await client.read('proj-b');
    expect(r?.status).toBe('off');
    expect(r?.restoration_data).toEqual({ ecs: { original_desired_count: 2 } });
  });

  it('transition rejects when current status mismatches expected (ConflictError)', async () => {
    await client.upsertInitial('proj-c');
    await expect(
      client.transition('proj-c', { from: 'off', to: 'transitioning', actor: 'atomoh' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
