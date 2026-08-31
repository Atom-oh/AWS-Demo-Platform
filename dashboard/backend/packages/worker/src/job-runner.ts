import type {
  Project,
  ResourceRefT,
  StateClient,
  JobsClient,
  HistoryClient,
  Logger,
  ScaleTarget,
} from '@demo-platform/shared';
import { stepKey } from '@demo-platform/shared';
import type { EcsController, EcsRestorationData } from './controllers/ecs.js';
import type { Ec2Controller, Ec2RestorationData } from './controllers/ec2.js';
import type { RdsController, RdsRestorationData } from './controllers/rds.js';
import type { ArgocdController, ArgocdRestorationData } from './controllers/argocd.js';

export interface JobInput {
  id: string;
  operation: 'turn_off' | 'turn_on' | 'scale';
  repo: string;
  actor: string;
  targets?: ScaleTarget[];
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
  if (opts.job.operation === 'scale') {
    return runScaleJob(opts);
  }
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
        const rd = await turnOffOne(res, controllers, ddb, job.repo);
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

// Structurally separate from the turn_on/turn_off postlude above: a scale job
// only ever updates the *job's* status, never the *project's* state.status —
// there is no markOn/markError call anywhere in this function.
async function runScaleJob(opts: RunJobOpts): Promise<void> {
  const { job, project, controllers, ddb, logger } = opts;
  await ddb.jobs.markRunning(job.id);
  logger.info({ jobId: job.id, op: job.operation }, 'job running');

  const targets = job.targets ?? [];
  if (targets.length === 0) {
    const msg = 'scale job has no targets';
    await ddb.jobs.markFailed(job.id, msg);
    await ddb.history.append({
      repo: job.repo,
      action: job.operation,
      actor: job.actor,
      account: opts.account,
      result: 'failure',
      details: { error: msg },
    });
    logger.error({ jobId: job.id }, msg);
    return;
  }

  // Start-of-branch status recheck: mitigates (does not eliminate) the
  // route-level check-then-act race against a concurrent turn_off. This is a
  // job-level abort, not a per-target failure — no appendProgress call is made
  // for any target, so the job's progress map ends up with zero entries, which
  // is what lets the frontend's toast logic treat it as "no attempt was made"
  // rather than the irreversibility-warning "failed:" case.
  const stateRec = await ddb.state.read(job.repo);
  if (stateRec?.status !== 'on') {
    const msg = `project no longer on (status=${stateRec?.status ?? 'unknown'})`;
    await ddb.jobs.markFailed(job.id, msg);
    await ddb.history.append({
      repo: job.repo,
      action: job.operation,
      actor: job.actor,
      account: opts.account,
      result: 'failure',
      details: { error: msg },
    });
    logger.warn({ jobId: job.id, repo: job.repo, status: stateRec?.status }, 'scale job aborted: project no longer on');
    return;
  }

  type ScalableResource = Extract<ResourceRefT, { type: 'ecs' } | { type: 'argocd-app' }>;
  const byStepKey = new Map<string, ScalableResource>();
  for (const res of project.resources) {
    if (res.type === 'ecs' || res.type === 'argocd-app') {
      byStepKey.set(stepKey(res), res);
    }
  }

  const errors: string[] = [];
  for (const t of targets) {
    try {
      const res = byStepKey.get(t.stepKey);
      if (!res) {
        throw new Error(`no ecs/argocd-app resource matches stepKey "${t.stepKey}"`);
      }
      if (res.type === 'ecs') {
        if (t.desiredCount === undefined) throw new Error('target is missing desiredCount');
        await controllers.ecs.setDesiredCount({
          cluster: res.cluster,
          service: res.service,
          count: t.desiredCount,
        });
      } else {
        if (t.replicas === undefined) throw new Error('target is missing replicas');
        const result = await controllers.argocd.scale(
          res.application,
          res.workload_selector.namespace,
          t.replicas,
        );
        await ddb.state.recordHpaBaselineIfAbsent(job.repo, t.stepKey, result.capturedHpaBounds);
      }
      await ddb.jobs.appendProgress(job.id, t.stepKey, 'done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${t.stepKey}: ${msg}`);
      await ddb.jobs.appendProgress(job.id, t.stepKey, `failed: ${msg}`);
      logger.error({ jobId: job.id, stepKey: t.stepKey, err }, 'scale target failed');
    }
  }

  const allFailed = errors.length === targets.length;
  if (errors.length === 0) {
    await ddb.jobs.markSucceeded(job.id);
  } else if (allFailed) {
    await ddb.jobs.markFailed(job.id, errors.join('; '));
  } else {
    await ddb.jobs.markPartialFailure(job.id, errors.join('; '));
  }

  await ddb.history.append({
    repo: job.repo,
    action: job.operation,
    actor: job.actor,
    account: opts.account,
    result: errors.length === 0 ? 'success' : allFailed ? 'failure' : 'partial',
    details: { targets, errors },
  });
}

async function turnOffOne(
  res: ResourceRefT,
  c: Controllers,
  ddb: DDB,
  repo: string,
): Promise<unknown> {
  switch (res.type) {
    case 'ecs':
      return c.ecs.turnOff({ cluster: res.cluster, service: res.service });
    case 'ec2':
      return c.ec2.turnOff({ instance_ids: res.instance_ids });
    case 'rds':
      if (res.always_on) return undefined;
      return c.rds.turnOff({ db_identifier: res.db_identifier });
    case 'argocd-app': {
      const rd = await c.argocd.turnOff({
        application: res.application,
        namespace: res.workload_selector.namespace,
      });
      // Record-then-read: if this is the first time ArgoCD's bounds have ever
      // been observed for this resource, the record wins and the read below
      // returns exactly what turnOff just captured (the true original, since
      // nothing scaled it yet). If a prior scale() already recorded the real
      // baseline, this record call is a harmless no-op and the read returns
      // that durable original instead of turnOff's own (possibly already
      // scale-collapsed) live observation.
      const key = stepKey(res);
      await ddb.state.recordHpaBaselineIfAbsent(repo, key, rd.hpas);
      const baseline = await ddb.state.readHpaBaseline(repo, key);
      if (baseline) rd.hpas = baseline;
      return rd;
    }
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
