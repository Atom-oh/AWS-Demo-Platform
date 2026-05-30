import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { Project, StateClient, JobsClient } from '@demo-platform/shared';
import { ConflictError, PermanentError } from '@demo-platform/shared';

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
    if (!project) throw new PermanentError(`project not found: ${repo}`);

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

  // Fastify requires the wildcard to be the last path segment, so we register a
  // single trailing-wildcard route and derive both the (multi-segment) repo and
  // the operation from the URL via regex.
  app.post('/api/projects/*', async (req, reply) => {
    const m = /^\/api\/projects\/(.+)\/actions\/(turn_off|turn_on)/.exec(req.url);
    if (!m || m[1] === undefined || m[2] === undefined) {
      throw new PermanentError('invalid url');
    }
    const repo = decodeURIComponent(m[1]);
    const op = m[2] as 'turn_off' | 'turn_on';
    return handle(op, req, reply, repo);
  });
}
