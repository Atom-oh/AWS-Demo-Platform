import type {
  Project,
  ResourceRefT,
  StateClient,
  JobsClient,
  HistoryClient,
  Logger,
} from '@demo-platform/shared';
import type { EcsController } from './controllers/ecs.js';
import type { Ec2Controller } from './controllers/ec2.js';
import type { RdsController } from './controllers/rds.js';
import type { ArgocdController } from './controllers/argocd.js';

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

  for (const res of project.resources) {
    if ('always_on' in res && res.always_on) continue; // visibility only
    const key = stepKey(res);
    try {
      if (job.operation === 'turn_off') {
        const rd = await turnOffOne(res, controllers);
        if (rd !== undefined) restoration[key] = rd;
        await ddb.jobs.appendProgress(job.id, key, 'done');
      } else {
        await turnOnOne(res, controllers);
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
  } else {
    await ddb.state.markOn(job.repo);
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

function stepKey(res: ResourceRefT): string {
  return res.type;
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
      return undefined; // always-on types (dynamodb/elasticache/kafka)
  }
}

// NOTE (Phase 1 stub): turn_on resource restoration is deferred to Phase 5.
// Restoration data lives in the DDB state record; threading it back into the
// controllers' turnOn() methods is not implemented yet. `_c` is intentionally
// unused until that wiring lands.
async function turnOnOne(res: ResourceRefT, _c: Controllers): Promise<void> {
  switch (res.type) {
    case 'ecs':
      return;
    default:
      return;
  }
}
