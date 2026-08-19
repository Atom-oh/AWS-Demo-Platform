import { describe, it, expect, vi } from 'vitest';
import type { Project } from '@demo-platform/shared';
import { buildServer } from '../server.js';

const project: Project = {
  name: 'p',
  github: { repo: 'o/r', branch: 'main' },
  account: 'atomoh-main',
  resources: [
    { type: 'ecs', cluster: 'c', service: 's' },
    {
      type: 'argocd-app',
      application: 'app-a',
      cluster: 'cl',
      workload_selector: { namespace: 'ns' },
      hpa_handling: 'scale_to_one',
    },
    { type: 'rds', db_identifier: 'db-1', always_on: true },
  ],
};

function deps(status: string) {
  const stateClient = { read: vi.fn(async () => ({ status })), transition: vi.fn() };
  const jobsClient = { create: vi.fn(async () => 'scale-job-1'), markFailed: vi.fn() };
  const sqsClient = { send: vi.fn(async () => ({})) };
  return { stateClient, jobsClient, sqsClient };
}

async function server(status: string, d = deps(status)) {
  const app = await buildServer({
    skipJwt: true,
    projects: { 'o/r': project },
    stateClient: d.stateClient as never,
    jobsClient: d.jobsClient as never,
    sqsClient: d.sqsClient as never,
    queueUrl: 'q',
  });
  return { app, d };
}

const post = (app: Awaited<ReturnType<typeof buildServer>>, body: unknown) =>
  app.inject({
    method: 'POST',
    url: '/api/projects/o/r/actions/scale',
    payload: body,
  });

describe('POST /api/projects/:owner/:name/actions/scale', () => {
  it('returns 409 when the project is not on', async () => {
    const { app } = await server('off');
    const res = await post(app, { targets: [{ stepKey: 'ecs:c/s', desiredCount: 3 }] });
    expect(res.statusCode).toBe(409);
  });

  it('returns 400 when targets is empty', async () => {
    const { app } = await server('on');
    const res = await post(app, { targets: [] });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when targets has duplicate stepKeys', async () => {
    const { app } = await server('on');
    const res = await post(app, {
      targets: [
        { stepKey: 'ecs:c/s', desiredCount: 3 },
        { stepKey: 'ecs:c/s', desiredCount: 5 },
      ],
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when a target stepKey matches no resource on the project', async () => {
    const { app } = await server('on');
    const res = await post(app, { targets: [{ stepKey: 'ecs:no/such', desiredCount: 3 }] });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when the matched resource type is not ecs/argocd-app (covers always_on too)', async () => {
    const { app } = await server('on');
    const res = await post(app, { targets: [{ stepKey: 'rds:db-1', desiredCount: 3 }] });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when an ecs target is missing desiredCount', async () => {
    const { app } = await server('on');
    const res = await post(app, { targets: [{ stepKey: 'ecs:c/s' }] });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when an ecs target carries replicas instead of desiredCount', async () => {
    const { app } = await server('on');
    const res = await post(app, { targets: [{ stepKey: 'ecs:c/s', replicas: 3 }] });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when a value is non-positive', async () => {
    const { app } = await server('on');
    const res = await post(app, { targets: [{ stepKey: 'ecs:c/s', desiredCount: 0 }] });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when a value exceeds MAX_SCALE_REPLICAS', async () => {
    const { app } = await server('on');
    const res = await post(app, { targets: [{ stepKey: 'ecs:c/s', desiredCount: 21 }] });
    expect(res.statusCode).toBe(400);
  });

  it('on success: creates a job with targets persisted, enqueues one message, returns 202 without changing status', async () => {
    const { app, d } = await server('on');
    const res = await post(app, {
      targets: [
        { stepKey: 'ecs:c/s', desiredCount: 4 },
        { stepKey: 'argocd-app:app-a', replicas: 5 },
      ],
    });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.payload).job_id).toBe('scale-job-1');
    expect(d.jobsClient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'o/r',
        operation: 'scale',
        targets: [
          { stepKey: 'ecs:c/s', desiredCount: 4 },
          { stepKey: 'argocd-app:app-a', replicas: 5 },
        ],
      }),
    );
    expect(d.sqsClient.send).toHaveBeenCalledTimes(1);
    expect(d.stateClient.transition).not.toHaveBeenCalled();
  });

  it('marks the job failed (not orphaned pending) when SQS enqueue fails', async () => {
    const d = deps('on');
    d.sqsClient.send = vi.fn(async () => {
      throw new Error('sqs down');
    });
    const { app } = await server('on', d);
    const res = await post(app, { targets: [{ stepKey: 'ecs:c/s', desiredCount: 4 }] });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(d.jobsClient.markFailed).toHaveBeenCalledWith('scale-job-1', expect.stringContaining('sqs down'));
  });
});
