import { describe, it, expect } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { makeClient, makeClientWithCreds } from '../client-factory.js';

describe('makeClient', () => {
  it('returns a DynamoDB client with region set', async () => {
    const client = makeClient(DynamoDBClient, { region: 'ap-northeast-2' });
    expect(await client.config.region()).toBe('ap-northeast-2');
  });

  it('uses endpoint override when AWS_ENDPOINT_URL set', async () => {
    const prev = process.env.AWS_ENDPOINT_URL;
    process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
    const client = makeClient(SQSClient, { region: 'ap-northeast-2' });
    const endpoint = await client.config.endpoint?.();
    expect(endpoint?.hostname).toBe('localhost');
    expect(endpoint?.port).toBe(4566);
    process.env.AWS_ENDPOINT_URL = prev;
  });
});

describe('makeClientWithCreds', () => {
  it('returns a client that uses provided credentials', async () => {
    const client = makeClientWithCreds(DynamoDBClient, {
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secret',
        sessionToken: 'token',
      },
    });
    const creds = await client.config.credentials();
    expect(creds.accessKeyId).toBe('AKIATEST');
    expect(creds.sessionToken).toBe('token');
  });
});
