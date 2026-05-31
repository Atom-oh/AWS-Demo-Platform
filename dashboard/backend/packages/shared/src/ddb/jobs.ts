import { randomUUID } from 'node:crypto';
import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  ScanCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { JobRecordSchema, type JobRecord } from '../schemas/ddb-records.js';
import { classifyAwsError } from '../errors.js';

const TTL_DAYS = 7;

export interface JobsClientOpts {
  doc: DynamoDBDocumentClient;
  tableName: string;
}

export class JobsClient {
  constructor(private readonly opts: JobsClientOpts) {}

  async create(args: { repo: string; operation: 'turn_off' | 'turn_on' }): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + TTL_DAYS * 86400;
    try {
      await this.opts.doc.send(
        new PutCommand({
          TableName: this.opts.tableName,
          Item: {
            pk: `job#${id}`,
            gsi1pk: `project#${args.repo}`,
            gsi1sk: now.toISOString(),
            operation: args.operation,
            status: 'pending',
            progress: {},
            created_at: now.toISOString(),
            ttl,
          },
        }),
      );
    } catch (err) {
      throw classifyAwsError(err);
    }
    return id;
  }

  async read(jobId: string): Promise<JobRecord | null> {
    try {
      const out = await this.opts.doc.send(
        new GetCommand({ TableName: this.opts.tableName, Key: { pk: `job#${jobId}` } }),
      );
      if (!out.Item) return null;
      return JobRecordSchema.parse(out.Item);
    } catch (err) {
      throw classifyAwsError(err);
    }
  }

  private async update(jobId: string, args: { update: string; values: Record<string, unknown>; names?: Record<string, string> }): Promise<void> {
    try {
      await this.opts.doc.send(
        new UpdateCommand({
          TableName: this.opts.tableName,
          Key: { pk: `job#${jobId}` },
          UpdateExpression: args.update,
          ExpressionAttributeValues: args.values,
          ExpressionAttributeNames: args.names,
        }),
      );
    } catch (err) {
      throw classifyAwsError(err);
    }
  }

  async markRunning(jobId: string): Promise<void> {
    await this.update(jobId, {
      update: 'SET #s = :r, started_at = :now',
      values: { ':r': 'running', ':now': new Date().toISOString() },
      names: { '#s': 'status' },
    });
  }

  async appendProgress(jobId: string, step: string, value: string): Promise<void> {
    await this.update(jobId, {
      update: 'SET progress.#k = :v',
      values: { ':v': value },
      names: { '#k': step },
    });
  }

  async markSucceeded(jobId: string): Promise<void> {
    await this.update(jobId, {
      update: 'SET #s = :s, completed_at = :now',
      values: { ':s': 'succeeded', ':now': new Date().toISOString() },
      names: { '#s': 'status' },
    });
  }

  async markPartialFailure(jobId: string, errMsg: string): Promise<void> {
    await this.update(jobId, {
      update: 'SET #s = :s, completed_at = :now, #e = :m',
      values: { ':s': 'partial_failure', ':now': new Date().toISOString(), ':m': errMsg },
      names: { '#s': 'status', '#e': 'error' },
    });
  }

  async markFailed(jobId: string, errMsg: string): Promise<void> {
    await this.update(jobId, {
      update: 'SET #s = :s, completed_at = :now, #e = :m',
      values: { ':s': 'failed', ':now': new Date().toISOString(), ':m': errMsg },
      names: { '#s': 'status', '#e': 'error' },
    });
  }

  /** Sweep: jobs in `running` for restart-after-crash recovery. */
  async listRunning(): Promise<JobRecord[]> {
    try {
      const out = await this.opts.doc.send(
        new ScanCommand({
          TableName: this.opts.tableName,
          FilterExpression: '#s = :r',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':r': 'running' },
        }),
      );
      return (out.Items ?? []).map((i) => JobRecordSchema.parse(i));
    } catch (err) {
      throw classifyAwsError(err);
    }
  }
}
