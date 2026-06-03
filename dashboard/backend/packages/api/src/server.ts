import Fastify, { type FastifyInstance } from 'fastify';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Project, Account } from '@demo-platform/shared';
import { createLogger, makeClient, StateClient, JobsClient } from '@demo-platform/shared';
import { registerHealth } from './routes/health.js';
import {
  registerJwtCognito,
  createCognitoVerifier,
  type JwtVerifier,
} from './plugins/jwt-cognito.js';
import { loadProjects } from './plugins/projects-loader.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { registerProjects } from './routes/projects.js';
import { registerActions } from './routes/actions.js';
import { registerJobs } from './routes/jobs.js';

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
    await registerJobs(app, { jobsClient: opts.jobsClient });
  }

  return app;
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing required env ${key}`);
  return v;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Production entry. Injects real deps so /api/* is live (not just /health).
  // JWT bypass is FAIL-CLOSED: enabled only when NODE_ENV is explicitly
  // 'development'. Any other value (including unset) enforces Cognito auth.
  const log = createLogger({ name: 'api' });
  const skipJwt = process.env.NODE_ENV === 'development';
  void (async () => {
    try {
      const region = process.env.AWS_REGION ?? 'ap-northeast-2';
      const projectsDir = process.env.PROJECTS_DIR ?? '/app/projects';
      const adminUsernames = (process.env.ADMIN_USERNAMES ?? 'atomoh')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const doc = DynamoDBDocumentClient.from(makeClient(DynamoDBClient, { region }));
      const stateClient = new StateClient({ doc, tableName: requireEnv('DDB_TABLE_STATE') });
      const jobsClient = new JobsClient({ doc, tableName: requireEnv('DDB_TABLE_JOBS') });
      const sqsClient = makeClient(SQSClient, { region });
      const queueUrl = requireEnv('SQS_QUEUE_URL');

      const projects = await loadProjects(projectsDir);
      log.info({ projects: Object.keys(projects).length }, 'projects loaded');

      // Verifier MUST exist when auth is enforced — registerJwtCognito 500s
      // ('jwt verifier not configured') otherwise. Uses access-token verification.
      let jwtVerifier: JwtVerifier | undefined;
      if (!skipJwt) {
        jwtVerifier = await createCognitoVerifier({
          userPoolId: requireEnv('COGNITO_USER_POOL_ID'),
          clientId: requireEnv('COGNITO_APP_CLIENT_ID'),
        });
      }

      const app = await buildServer({
        skipJwt,
        jwtVerifier,
        adminUsernames,
        projects,
        stateClient,
        jobsClient,
        sqsClient,
        queueUrl,
      });
      const port = Number(process.env.PORT ?? 8080);
      await app.listen({ port, host: '0.0.0.0' });
      log.info({ port, skipJwt, hasVerifier: Boolean(jwtVerifier) }, 'api listening');
    } catch (err) {
      log.error({ err }, 'api failed to start');
      process.exit(1);
    }
  })();
}
