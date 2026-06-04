import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { Project, StateClient, JobsClient } from '@demo-platform/shared';
import { ConflictError, NotFoundError } from '@demo-platform/shared';

export interface ActionsRouteDeps {
  projects: Record<string, Project>;
  stateClient: StateClient;
  jobsClient: JobsClient;
  sqsClient: SQSClient;
  queueUrl: string;
}

export async function registerActions(
  app: FastifyInstance,
  deps: ActionsRouteDeps,
): Promise<void> {
  async function handle(
    op: 'turn_off' | 'turn_on',
    req: FastifyRequest,
    reply: FastifyReply,
    repo: string,
  ): Promise<void> {
    const project = deps.projects[repo];
    if (!project) throw new NotFoundError(`project not found: ${repo}`);

    const state = await deps.stateClient.read(repo);
    const current = state?.status;
    // turn_off requires 'on'. turn_on accepts 'off' OR 'error' — a prior
    // partial turn_on leaves status='error' (with restoration_data preserved),
    // and that must be retryable via the API (not a dead-end requiring a manual
    // DDB edit). The transition condition uses the ACTUAL current status.
    const validFrom: string[] = op === 'turn_off' ? ['on'] : ['off', 'error'];
    if (!current || !validFrom.includes(current)) {
      throw new ConflictError(
        `expected status in [${validFrom.join(',')}], current=${current ?? 'unknown'}`,
      );
    }

    const actor = req.user?.username ?? 'system';
    await deps.stateClient.transition(repo, { from: current, to: 'transitioning', actor });

    const jobId = await deps.jobsClient.create({ repo, operation: op });
    try {
      await deps.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: deps.queueUrl,
          MessageBody: JSON.stringify({ jobId, repo, operation: op }),
        }),
      );
    } catch (err) {
      // Enqueue failed — roll back so the project isn't stuck in `transitioning`
      // (a pending job would never be picked up: the sweep only finds `running`).
      await deps.jobsClient.markFailed(jobId, `enqueue failed: ${(err as Error).message}`);
      await deps.stateClient.transition(repo, { from: 'transitioning', to: current, actor });
      throw err;
    }
    void reply.code(202).send({ job_id: jobId });
  }

  // Repos are always `owner/name`; use explicit path params + a constrained op.
  app.post('/api/projects/:owner/:name/actions/:op', async (req, reply) => {
    const { owner, name, op } = req.params as { owner: string; name: string; op: string };
    if (op !== 'turn_off' && op !== 'turn_on') {
      throw new NotFoundError(`unknown action: ${op}`);
    }
    const repo = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
    return handle(op, req, reply, repo);
  });
}
