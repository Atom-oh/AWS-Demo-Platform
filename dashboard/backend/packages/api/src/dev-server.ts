/**
 * Local DEV server — NOT a production entry.
 *
 * Runs the REAL Fastify API (same routes as prod) but wires in-memory
 * State/Jobs clients and a fake SQS that *simulates the worker* so toggles
 * actually complete end-to-end. Also serves a single-page dashboard at `/`.
 *
 * Purpose: let us see a live, API-connected dashboard without DynamoDB,
 * Cognito, CORS, or a separate frontend build. Data is real (projects/*.yaml);
 * resource state is simulated.
 *
 *   node packages/api/dist/dev-server.js   # from dashboard/backend
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createLogger } from '@demo-platform/shared';
import type { StateClient, JobsClient } from '@demo-platform/shared';
import type { StateRecord, JobRecord, ProjectStatusT } from '@demo-platform/shared';
import { buildServer } from './server.js';
import { loadProjects } from './plugins/projects-loader.js';

const log = createLogger({ name: 'dev-server' });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR =
  process.env.PROJECTS_DIR ?? path.resolve(__dirname, '../../../../../projects');
const DASHBOARD_HTML = readFileSync(
  path.resolve(__dirname, '../../../dev/dashboard.html'),
  'utf8',
);

// ---- in-memory State client (implements the subset the routes use) ---------
function makeStateClient(repos: string[]): StateClient {
  const now = () => new Date().toISOString();
  const store = new Map<string, StateRecord>();
  repos.forEach((repo, i) => {
    const status: ProjectStatusT = i % 2 === 0 ? 'on' : 'off';
    store.set(repo, {
      pk: `project#${repo}`,
      sk: 'current',
      status,
      last_action: 'init',
      last_action_at: now(),
      updated_at: now(),
      ...(status === 'off' ? { restoration_data: {} } : {}),
    } as StateRecord);
  });
  return {
    async read(repo: string) {
      return store.get(repo) ?? null;
    },
    async transition(repo: string, args: { from: ProjectStatusT; to: ProjectStatusT; actor: string }) {
      const rec = store.get(repo);
      if (!rec) return;
      rec.status = args.to;
      rec.last_actor = args.actor;
      rec.last_action_at = now();
      rec.updated_at = now();
      if (args.to === 'off' && !('restoration_data' in rec)) {
        (rec as Record<string, unknown>).restoration_data = {};
      }
    },
    // Convenience used by the simulated worker.
    _set(repo: string, status: ProjectStatusT) {
      const rec = store.get(repo);
      if (rec) {
        rec.status = status;
        rec.updated_at = now();
      }
    },
  } as unknown as StateClient;
}

// ---- in-memory Jobs client -------------------------------------------------
function makeJobsClient(): JobsClient {
  const now = () => new Date().toISOString();
  const store = new Map<string, JobRecord>();
  let seq = 0;
  return {
    async create(args: { repo: string; operation: 'turn_off' | 'turn_on' }) {
      const id = `dev-${++seq}-${Math.floor(performance.now())}`;
      store.set(id, {
        pk: `job#${id}`,
        gsi1pk: `project#${args.repo}`,
        gsi1sk: now(),
        operation: args.operation,
        status: 'pending',
        progress: {},
        created_at: now(),
        ttl: Math.floor(Date.now() / 1000) + 86400,
      } as JobRecord);
      return id;
    },
    async read(id: string) {
      return store.get(id) ?? null;
    },
    async markRunning(id: string) {
      const j = store.get(id);
      if (j) {
        j.status = 'running';
        j.started_at = now();
      }
    },
    async markSucceeded(id: string) {
      const j = store.get(id);
      if (j) {
        j.status = 'succeeded';
        j.completed_at = now();
      }
    },
    async markFailed(id: string, errMsg: string) {
      const j = store.get(id);
      if (j) {
        j.status = 'failed';
        j.error = errMsg;
        j.completed_at = now();
      }
    },
    _setProgress(id: string, progress: Record<string, string>) {
      const j = store.get(id);
      if (j) j.progress = { ...j.progress, ...progress };
    },
  } as unknown as JobsClient;
}

async function main(): Promise<void> {
  const projects = await loadProjects(PROJECTS_DIR);
  const repos = Object.keys(projects);
  const stateClient = makeStateClient(repos);
  const jobsClient = makeJobsClient();

  // Fake SQS: instead of enqueuing, simulate the worker progressing the job.
  const sqsClient = {
    async send(cmd: { input?: { MessageBody?: string } }) {
      const body = JSON.parse(cmd?.input?.MessageBody ?? '{}') as {
        jobId: string;
        repo: string;
        operation: 'turn_off' | 'turn_on';
      };
      const jc = jobsClient as unknown as {
        markRunning(id: string): Promise<void>;
        markSucceeded(id: string): Promise<void>;
        _setProgress(id: string, p: Record<string, string>): void;
      };
      const sc = stateClient as unknown as { _set(repo: string, s: ProjectStatusT): void };
      const target: ProjectStatusT = body.operation === 'turn_on' ? 'on' : 'off';
      setTimeout(() => void jc.markRunning(body.jobId), 300);
      setTimeout(() => jc._setProgress(body.jobId, { phase: 'resources', step: '1/2' }), 1200);
      setTimeout(() => jc._setProgress(body.jobId, { phase: 'verify', step: '2/2' }), 2600);
      setTimeout(() => {
        sc._set(body.repo, target);
        void jc.markSucceeded(body.jobId);
      }, 3800);
      return {};
    },
  };

  const app = await buildServer({
    skipJwt: true,
    projects,
    stateClient,
    jobsClient,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sqsClient: sqsClient as any,
    queueUrl: 'dev://in-memory',
  });

  app.get('/', async (_req, reply) => reply.type('text/html').send(DASHBOARD_HTML));

  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port, projects: repos.length }, 'dev-server listening (in-memory state, simulated worker)');
}

main().catch((err) => {
  log.error({ err }, 'dev-server failed');
  process.exit(1);
});
