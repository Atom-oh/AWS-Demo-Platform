import type { FastifyInstance } from 'fastify';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { Project, StateClient, JobsClient, ScaleTarget, ResourceRefT } from '@demo-platform/shared';
import { ConflictError, NotFoundError, PermanentError, stepKey, MAX_SCALE_REPLICAS } from '@demo-platform/shared';

export interface ScaleRouteDeps {
  projects: Record<string, Project>;
  stateClient: StateClient;
  jobsClient: JobsClient;
  sqsClient: SQSClient;
  queueUrl: string;
}

interface RawScaleTarget {
  stepKey?: unknown;
  replicas?: unknown;
  desiredCount?: unknown;
}

type ScalableResource = Extract<ResourceRefT, { type: 'ecs' } | { type: 'argocd-app' }>;

function isPositiveIntWithinCeiling(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_SCALE_REPLICAS;
}

// Validates the raw request body into a well-formed ScaleTarget[], throwing
// PermanentError (→ 400) on the first problem found. This is a plain,
// eventually-consistent status read via StateClient.read() (no new client
// method needed) — scale has no status transition of its own to attach a
// DynamoDB ConditionExpression to, so this narrows but doesn't fully close
// the check-then-act race against a concurrent turn_off; the worker's own
// start-of-branch status recheck is the mitigation for the rest of that window.
function validateTargets(
  rawTargets: unknown,
  byStepKey: Map<string, ScalableResource>,
): ScaleTarget[] {
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
    throw new PermanentError('targets must be a non-empty array');
  }
  const seen = new Set<string>();
  const targets: ScaleTarget[] = [];
  for (const raw of rawTargets as RawScaleTarget[]) {
    const key = raw.stepKey;
    if (typeof key !== 'string' || key.length === 0) {
      throw new PermanentError('each target must have a non-empty stepKey');
    }
    if (seen.has(key)) {
      throw new PermanentError(`duplicate stepKey in targets: ${key}`);
    }
    seen.add(key);

    const res = byStepKey.get(key);
    if (!res) {
      // Covers both "unknown stepKey" and "no scale concept for this resource
      // type/always_on" — only ecs/argocd-app resources are in byStepKey at all.
      throw new PermanentError(`stepKey does not match a scalable resource: ${key}`);
    }

    if (res.type === 'ecs') {
      if (raw.replicas !== undefined) {
        throw new PermanentError(`ecs target ${key} must not carry replicas`);
      }
      if (!isPositiveIntWithinCeiling(raw.desiredCount)) {
        throw new PermanentError(
          `ecs target ${key} requires a positive integer desiredCount <= ${MAX_SCALE_REPLICAS}`,
        );
      }
      targets.push({ stepKey: key, desiredCount: raw.desiredCount });
    } else {
      if (raw.desiredCount !== undefined) {
        throw new PermanentError(`argocd-app target ${key} must not carry desiredCount`);
      }
      if (!isPositiveIntWithinCeiling(raw.replicas)) {
        throw new PermanentError(
          `argocd-app target ${key} requires a positive integer replicas <= ${MAX_SCALE_REPLICAS}`,
        );
      }
      targets.push({ stepKey: key, replicas: raw.replicas });
    }
  }
  return targets;
}

export async function registerScale(app: FastifyInstance, deps: ScaleRouteDeps): Promise<void> {
  app.post('/api/projects/:owner/:name/actions/scale', async (req, reply) => {
    const { owner, name } = req.params as { owner: string; name: string };
    const repo = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
    const project = deps.projects[repo];
    if (!project) throw new NotFoundError(`project not found: ${repo}`);

    const state = await deps.stateClient.read(repo);
    if (state?.status !== 'on') {
      throw new ConflictError(`scale requires status 'on', current=${state?.status ?? 'unknown'}`);
    }

    const byStepKey = new Map<string, ScalableResource>();
    for (const res of project.resources) {
      if (res.type === 'ecs' || res.type === 'argocd-app') {
        byStepKey.set(stepKey(res), res);
      }
    }

    const body = (req.body ?? {}) as { targets?: unknown };
    const targets = validateTargets(body.targets, byStepKey);

    const jobId = await deps.jobsClient.create({ repo, operation: 'scale', targets });
    try {
      await deps.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: deps.queueUrl,
          MessageBody: JSON.stringify({ jobId, repo, operation: 'scale', targets }),
        }),
      );
    } catch (err) {
      // No project-status rollback needed (scale never transitions status) —
      // but the job record must not stay orphaned `pending`, since sweepRunningJobs
      // only recovers `running` jobs.
      await deps.jobsClient.markFailed(jobId, `enqueue failed: ${(err as Error).message}`);
      throw err;
    }
    void reply.code(202).send({ job_id: jobId });
  });
}
