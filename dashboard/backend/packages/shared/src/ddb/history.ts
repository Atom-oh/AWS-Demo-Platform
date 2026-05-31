import { randomUUID } from 'node:crypto';
import {
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { HistoryRecordSchema, type HistoryRecord } from '../schemas/ddb-records.js';
import { classifyAwsError } from '../errors.js';

const TTL_DAYS = 90;

export interface HistoryClientOpts {
  doc: DynamoDBDocumentClient;
  tableName: string;
}

export interface AppendArgs {
  repo: string;
  action: string;
  actor: string;
  account: string;
  result: 'success' | 'failure' | 'partial';
  details?: Record<string, unknown>;
}

export class HistoryClient {
  constructor(private readonly opts: HistoryClientOpts) {}

  async append(args: AppendArgs): Promise<void> {
    const now = new Date();
    const sk = `${now.toISOString()}#${randomUUID()}`;
    const ttl = Math.floor(now.getTime() / 1000) + TTL_DAYS * 86400;
    try {
      await this.opts.doc.send(
        new PutCommand({
          TableName: this.opts.tableName,
          Item: {
            pk: `project#${args.repo}`,
            sk,
            action: args.action,
            actor: args.actor,
            account: args.account,
            result: args.result,
            details: args.details,
            ttl,
          },
        }),
      );
    } catch (err) {
      throw classifyAwsError(err);
    }
  }

  async list(repo: string, limit: number = 50): Promise<HistoryRecord[]> {
    try {
      const out = await this.opts.doc.send(
        new QueryCommand({
          TableName: this.opts.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': `project#${repo}` },
          ScanIndexForward: false,
          Limit: limit,
        }),
      );
      return (out.Items ?? []).map((i) => HistoryRecordSchema.parse(i));
    } catch (err) {
      throw classifyAwsError(err);
    }
  }
}
