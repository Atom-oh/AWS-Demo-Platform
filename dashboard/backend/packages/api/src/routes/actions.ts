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
    const want = op === 'turn_off' ? 'on' : 'off';
    if (state?.status !== want) {
      throw new ConflictError(`expected status=${want}, current=${state?.status ?? 'unknown'}`);
    }

    await deps.stateClient.transition(repo, {
      from: want,
      to: 'transitioning',
      actor: req.user?.username ?? 'system',
    });

    const jobId = await deps.jobsClient.create({ repo, operation: op });
    await deps.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: deps.queueUrl,
        MessageBody: JSON.stringify({ jobId, repo, operation: op }),
      }),
    );
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
