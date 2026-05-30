import Fastify, { type FastifyInstance } from 'fastify';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type {
  Project,
  Account,
  StateClient,
  JobsClient,
} from '@demo-platform/shared';
import { registerHealth } from './routes/health.js';
import { registerJwtCognito, type JwtVerifier } from './plugins/jwt-cognito.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { registerProjects } from './routes/projects.js';
import { registerActions } from './routes/actions.js';

export interface BuildServerOpts {
  skipJwt?: boolean;
  jwtVerifier?: JwtVerifier;
  projects?: Record<string, Project>;
  accounts?: Record<string, Account>;
  stateClient?: StateClient;
  jobsClient?: JobsClient;
  sqsClient?: SQSClient;
  queueUrl?: string;
  adminUsernames?: string[];
}

export async function buildServer(opts: BuildServerOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  await registerJwtCognito(app, {
    adminUsernames: opts.adminUsernames ?? ['atomoh'],
    verifier: opts.jwtVerifier,
    skipJwt: opts.skipJwt ?? false,
    skipPaths: ['/health'],
  });

  await registerHealth(app);

  if (opts.projects && opts.stateClient) {
    await registerProjects(app, { projects: opts.projects, stateClient: opts.stateClient });
    if (opts.jobsClient && opts.sqsClient && opts.queueUrl) {
      await registerActions(app, {
        projects: opts.projects,
        stateClient: opts.stateClient,
        jobsClient: opts.jobsClient,
        sqsClient: opts.sqsClient,
        queueUrl: opts.queueUrl,
      });
    }
  }

  if (opts.jobsClient) {
    const { registerJobs } = await import('./routes/jobs.js');
    await registerJobs(app, { jobsClient: opts.jobsClient });
  }

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // production entry is handled by future Task in Phase 4; for now buildServer with empty deps yields /health only.
  buildServer({ skipJwt: true }).then(async (app) => {
    const port = Number(process.env.PORT ?? 8080);
    await app.listen({ port, host: '0.0.0.0' });
    // eslint-disable-next-line no-console
    console.log(`api listening on :${port}`);
  });
}
