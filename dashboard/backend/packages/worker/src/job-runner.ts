import type {
  Project,
  ResourceRefT,
  StateClient,
  JobsClient,
  HistoryClient,
  Logger,
} from '@demo-platform/shared';
import type { EcsController, EcsRestorationData } from './controllers/ecs.js';
import type { Ec2Controller, Ec2RestorationData } from './controllers/ec2.js';
import type { RdsController, RdsRestorationData } from './controllers/rds.js';
import type { ArgocdController, ArgocdRestorationData } from './controllers/argocd.js';

export interface JobInput {
  id: string;
  operation: 'turn_off' | 'turn_on';
  repo: string;
  actor: string;
}

export interface Controllers {
  ecs: EcsController;
  ec2: Ec2Controller;
  rds: RdsController;
  argocd: ArgocdController;
}

export interface DDB {
  state: StateClient;
  jobs: JobsClient;
  history: HistoryClient;
}

export interface RunJobOpts {
  job: JobInput;
  project: Project;
  account: string;
  controllers: Controllers;
  ddb: DDB;
  logger: Logger;
}

export async function runJob(opts: RunJobOpts): Promise<void> {
  const { job, project, controllers, ddb, logger } = opts;
  await ddb.jobs.markRunning(job.id);
  logger.info({ jobId: job.id, op: job.operation }, 'job running');

  const restoration: Record<string, unknown> = {};
  const errors: string[] = [];
  // RDS start is asynchronous at AWS (minutes); we poll availability AFTER the
  // job is marked, so the SQS message isn't held past its visibility timeout.
  const rdsToAwait: string[] = [];

  // turn_on restores resources from the data captured at turn_off time, which
  // lives on the off-state DDB record. Read it once up front. Keyed by stepKey.
  let restorationMap: Record<string, unknown> = {};
  if (job.operation === 'turn_on') {
    const stateRec = await ddb.state.read(job.repo);
    restorationMap = (stateRec?.restoration_data ?? {}) as Record<string, unknown>;
    if (Object.keys(restorationMap).length === 0) {
      // Best-effort (non-prod): nothing to restore (already on, or data pruned).
      logger.warn({ jobId: job.id, repo: job.repo }, 'turn_on with empty restoration_data');
    }
  }

  for (const res of project.resources) {
    if ('always_on' in res && res.always_on) continue; // visibility only
    const key = stepKey(res);
    try {
      if (job.operation === 'turn_off') {
        const rd = await turnOffOne(res, controllers);
        if (rd !== undefined) restoration[key] = rd;
        await ddb.jobs.appendProgress(job.id, key, 'done');
      } else {
        const rdsId = await turnOnOne(res, controllers, restorationMap[key]);
        if (rdsId) rdsToAwait.push(rdsId);
        await ddb.jobs.appendProgress(job.id, key, 'done');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${key}: ${msg}`);
      await ddb.jobs.appendProgress(job.id, key, `failed: ${msg}`);
      logger.error({ jobId: job.id, key, err }, 'step failed');
    }
  }

  if (job.operation === 'turn_off') {
    await ddb.state.markOff(job.repo, { restoration_data: restoration });
  } else if (errors.length === 0) {
    await ddb.state.markOn(job.repo);
  } else {
    // Partial turn_on: markOn would REMOVE restoration_data, stranding the
    // resources that failed to come back. markError preserves it (unconditional,
    // leaves restoration_data intact); the api's turn_on accepts status='error',
    // so the project stays retryable via the API (no manual DDB edit needed).
    await ddb.state.markError(job.repo, `turn_on partial failure: ${errors.join('; ')}`);
  }

  // Fire-and-forget RDS availability polling (never awaited inside the handler).
  for (const id of rdsToAwait) {
    void controllers.rds
      .waitForAvailable(id)
      .catch((err) => logger.warn({ jobId: job.id, id, err }, 'rds waitForAvailable failed'));
  }

  if (errors.length === 0) {
    await ddb.jobs.markSucceeded(job.id);
    await ddb.history.append({
      repo: job.repo,
      action: job.operation,
      actor: job.actor,
      account: opts.account,
      result: 'success',
      details: restoration,
    });
  } else {
    await ddb.jobs.markPartialFailure(job.id, errors.join('; '));
    await ddb.history.append({
      repo: job.repo,
      action: job.operation,
      actor: job.actor,
      account: opts.account,
      result: 'partial',
      details: { restoration, errors },
    });
  }
}

// Unique per-resource key so multiple resources of the same type (e.g. a project
// with two argocd-app entries) each keep their own restoration_data. The same key
// is used for the turn_off write and the turn_on read, so restoration is symmetric.
// Visibility-only types are skipped before this is called, so they fall to `type`.
function stepKey(res: ResourceRefT): string {
  switch (res.type) {
    case 'ecs':
      return `ecs:${res.cluster}/${res.service}`;
    case 'ec2':
      return `ec2:${res.instance_ids.join(',')}`;
    case 'rds':
      return `rds:${res.db_identifier}`;
    case 'argocd-app':
      return `argocd-app:${res.application}`;
    default:
      return res.type;
  }
}

async function turnOffOne(res: ResourceRefT, c: Controllers): Promise<unknown> {
  switch (res.type) {
    case 'ecs':
      return c.ecs.turnOff({ cluster: res.cluster, service: res.service });
    case 'ec2':
      return c.ec2.turnOff({ instance_ids: res.instance_ids });
    case 'rds':
      if (res.always_on) return undefined;
      return c.rds.turnOff({ db_identifier: res.db_identifier });
    case 'argocd-app':
      return c.argocd.turnOff({ application: res.application });
    default:
      return undefined; // always-on types (dynamodb/elasticache/kafka/...)
  }
}

// Restore one resource from its captured restoration_data (rd). Returns an RDS
// db identifier to background-poll for availability, or undefined. A missing rd
// (undefined) is an idempotent skip — e.g. the resource was already on, was added
// after turn_off, or its data was pruned.
async function turnOnOne(
  res: ResourceRefT,
  c: Controllers,
  rd: unknown,
): Promise<string | undefined> {
  switch (res.type) {
    case 'ecs':
      if (!rd) return undefined;
      await c.ecs.turnOn(rd as EcsRestorationData);
      return undefined;
    case 'ec2':
      if (!rd) return undefined;
      await c.ec2.turnOn(rd as Ec2RestorationData);
      return undefined;
    case 'rds':
      if (res.always_on || !rd) return undefined;
      await c.rds.turnOn(rd as RdsRestorationData);
      return res.db_identifier; // poll availability in the background
    case 'argocd-app':
      if (!rd) return undefined;
      await c.argocd.turnOn(rd as ArgocdRestorationData);
      return undefined;
    default:
      return undefined; // visibility-only types
  }
}
