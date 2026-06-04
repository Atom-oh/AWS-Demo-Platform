import { describe, it, expect, vi } from 'vitest';
import type { Project } from '@demo-platform/shared';
import { buildServer } from '../server.js';

const project: Project = {
  name: 'p',
  github: { repo: 'o/r', branch: 'main' },
  account: 'atomoh-main',
  resources: [{ type: 'ecs', cluster: 'c', service: 's' }],
};

function deps(status: string) {
  const stateClient = {
    read: vi.fn(async () => ({ status })),
    transition: vi.fn(async () => {}),
  };
  const jobsClient = { create: vi.fn(async () => 'job-1'), markFailed: vi.fn() };
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

describe('actions route — turn_on accepts off OR error (recovery path)', () => {
  it('turn_on from error returns 202 and transitions from error', async () => {
    const { app, d } = await server('error');
    const res = await app.inject({ method: 'POST', url: '/api/projects/o/r/actions/turn_on' });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.payload).job_id).toBe('job-1');
    expect(d.stateClient.transition).toHaveBeenCalledWith(
      'o/r',
      expect.objectContaining({ from: 'error', to: 'transitioning' }),
    );
    expect(d.sqsClient.send).toHaveBeenCalled();
  });

  it('turn_on from off returns 202', async () => {
    const { app } = await server('off');
    const res = await app.inject({ method: 'POST', url: '/api/projects/o/r/actions/turn_on' });
    expect(res.statusCode).toBe(202);
  });

  it('turn_on from on returns 409 (already on)', async () => {
    const { app } = await server('on');
    const res = await app.inject({ method: 'POST', url: '/api/projects/o/r/actions/turn_on' });
    expect(res.statusCode).toBe(409);
  });

  it('turn_off from on returns 202; from off returns 409', async () => {
    const on = await server('on');
    expect((await on.app.inject({ method: 'POST', url: '/api/projects/o/r/actions/turn_off' })).statusCode).toBe(202);
    const off = await server('off');
    expect((await off.app.inject({ method: 'POST', url: '/api/projects/o/r/actions/turn_off' })).statusCode).toBe(409);
  });
});
