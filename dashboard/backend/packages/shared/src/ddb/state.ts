import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  StateRecordSchema,
  HpaBaselineRecordSchema,
  type StateRecord,
  type ProjectStatusT,
} from '../schemas/ddb-records.js';
import { classifyAwsError } from '../errors.js';

export interface StateClientOpts {
  doc: DynamoDBDocumentClient;
  tableName: string;
}

export class StateClient {
  constructor(private readonly opts: StateClientOpts) {}

  private pk(repo: string): string {
    return `project#${repo}`;
  }

  async read(repo: string): Promise<StateRecord | null> {
    try {
      const out = await this.opts.doc.send(
        new GetCommand({
          TableName: this.opts.tableName,
          Key: { pk: this.pk(repo), sk: 'current' },
        }),
      );
      if (!out.Item) return null;
      return StateRecordSchema.parse(out.Item);
    } catch (err) {
      throw classifyAwsError(err);
    }
  }

  async upsertInitial(repo: string): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.opts.doc.send(
        new PutCommand({
          TableName: this.opts.tableName,
          Item: {
            pk: this.pk(repo),
            sk: 'current',
            status: 'on',
            last_action: 'init',
            last_action_at: now,
            updated_at: now,
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch (err) {
      // existing OK (ignore conditional fail), other errors rethrow
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return;
      throw classifyAwsError(err);
    }
  }

  async transition(
    repo: string,
    args: { from: ProjectStatusT; to: ProjectStatusT; actor: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.opts.doc.send(
        new UpdateCommand({
          TableName: this.opts.tableName,
          Key: { pk: this.pk(repo), sk: 'current' },
          UpdateExpression:
            'SET #s = :to, last_actor = :actor, last_action_at = :now, updated_at = :now',
          ConditionExpression: '#s = :from',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':from': args.from,
            ':to': args.to,
            ':actor': args.actor,
            ':now': now,
          },
        }),
      );
    } catch (err) {
      // classifyAwsError maps ConditionalCheckFailedException → ConflictError,
      // which the API surfaces as 409 (concurrent / stale-state transition).
      throw classifyAwsError(err);
    }
  }

  async markOff(
    repo: string,
    args: { restoration_data: Record<string, unknown> },
  ): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.opts.doc.send(
        new UpdateCommand({
          TableName: this.opts.tableName,
          Key: { pk: this.pk(repo), sk: 'current' },
          UpdateExpression:
            'SET #s = :off, restoration_data = :rd, last_action = :a, last_action_at = :now, updated_at = :now',
          ConditionExpression: '#s = :transitioning',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':off': 'off',
            ':rd': args.restoration_data,
            ':a': 'turn_off',
            ':now': now,
            ':transitioning': 'transitioning',
          },
        }),
      );
    } catch (err) {
      throw classifyAwsError(err);
    }
  }

  async markOn(repo: string): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.opts.doc.send(
        new UpdateCommand({
          TableName: this.opts.tableName,
          Key: { pk: this.pk(repo), sk: 'current' },
          UpdateExpression:
            'SET #s = :on, last_action = :a, last_action_at = :now, updated_at = :now REMOVE restoration_data',
          ConditionExpression: '#s = :transitioning',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':on': 'on',
            ':a': 'turn_on',
            ':now': now,
            ':transitioning': 'transitioning',
          },
        }),
      );
    } catch (err) {
      throw classifyAwsError(err);
    }
  }

  // Write-once (attribute_not_exists(pk) on a dedicated sk, not a field on the
  // "current" item) so the FIRST bounds ArgoCD ever reports for this resource — via
  // whichever call (scale or turn_off) observes them first — become the permanent
  // baseline. A no-op if a baseline already exists; see HpaBaselineRecordSchema.
  async recordHpaBaselineIfAbsent(
    repo: string,
    stepKey: string,
    hpas: Record<string, { min: number; max: number }>,
  ): Promise<void> {
    if (Object.keys(hpas).length === 0) return;
    try {
      await this.opts.doc.send(
        new PutCommand({
          TableName: this.opts.tableName,
          Item: { pk: this.pk(repo), sk: `hpa-baseline#${stepKey}`, hpas },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return;
      throw classifyAwsError(err);
    }
  }

  async readHpaBaseline(
    repo: string,
    stepKey: string,
  ): Promise<Record<string, { min: number; max: number }> | null> {
    try {
      const out = await this.opts.doc.send(
        new GetCommand({
          TableName: this.opts.tableName,
          Key: { pk: this.pk(repo), sk: `hpa-baseline#${stepKey}` },
        }),
      );
      if (!out.Item) return null;
      return HpaBaselineRecordSchema.parse(out.Item).hpas;
    } catch (err) {
      throw classifyAwsError(err);
    }
  }

  async markError(repo: string, message: string): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.opts.doc.send(
        new UpdateCommand({
          TableName: this.opts.tableName,
          Key: { pk: this.pk(repo), sk: 'current' },
          UpdateExpression:
            'SET #s = :e, error_message = :m, last_action_at = :now, updated_at = :now',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':e': 'error',
            ':m': message,
            ':now': now,
          },
        }),
      );
    } catch (err) {
      throw classifyAwsError(err);
    }
  }
}
