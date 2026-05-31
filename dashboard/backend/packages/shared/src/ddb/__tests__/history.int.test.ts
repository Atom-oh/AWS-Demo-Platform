import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { makeClient } from '../../aws/client-factory.js';
import { ensureHistoryTable } from './setup-localstack.js';
import { HistoryClient } from '../history.js';

const TABLE = 'test-history';

describe('HistoryClient (integration)', () => {
  let doc: DynamoDBDocumentClient;
  let client: HistoryClient;

  beforeAll(async () => {
    process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    const raw = makeClient(DynamoDBClient, { region: 'ap-northeast-2' });
    await ensureHistoryTable(raw, TABLE);
    doc = DynamoDBDocumentClient.from(raw);
    client = new HistoryClient({ doc, tableName: TABLE });
  });

  afterAll(() => doc.destroy());

  it('appends and lists history for a project', async () => {
    await client.append({
      repo: 'foo/bar',
      action: 'turn_off',
      actor: 'atomoh',
      account: 'atomoh-main',
      result: 'success',
      details: { ecs: 'done' },
    });
    await client.append({
      repo: 'foo/bar',
      action: 'turn_on',
      actor: 'atomoh',
      account: 'atomoh-main',
      result: 'success',
    });
    const out = await client.list('foo/bar', 10);
    expect(out).toHaveLength(2);
    expect(out[0].action === 'turn_on' || out[1].action === 'turn_on').toBe(true);
  });
});
