import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import type { Project } from '@demo-platform/shared';

const project: Project = {
  name: 'external', github: { repo: 'org/external', branch: 'main' },
  account: 'atomoh-main', management: 'external',
  resources: [{ type: 'ecs', cluster: 'external-cluster', service: 'service' }],
};

describe('externally managed projects', () => {
  it.each(['turn_on', 'turn_off', 'scale'])('rejects %s before state or queue writes', async (operation) => {
    const state = { read: vi.fn(async () => ({ status: operation === 'turn_on' ? 'off' : 'on' })), transition: vi.fn() };
    const jobs = { create: vi.fn(async () => 'job') };
    const sqs = { send: vi.fn() };
    const app = await buildServer({
      skipJwt: true, projects: { 'org/external': project },
      stateClient: state as never, jobsClient: jobs as never, sqsClient: sqs as never, queueUrl: 'q',
    });
    const response = await app.inject({
      method: 'POST', url: `/api/projects/org/external/actions/${operation}`,
      payload: { targets: [{ stepKey: 'ecs:external-cluster/service', desiredCount: 2 }] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toContain('externally managed');
    expect(state.read).not.toHaveBeenCalled();
    expect(state.transition).not.toHaveBeenCalled();
    expect(jobs.create).not.toHaveBeenCalled();
    expect(sqs.send).not.toHaveBeenCalled();
    await app.close();
  });

  it('still exposes metadata without manufacturing an on state', async () => {
    const read = vi.fn(async () => ({ status: 'on' }));
    const app = await buildServer({
      skipJwt: true, projects: { 'org/external': project },
      stateClient: { read } as never,
    });
    const response = await app.inject('/api/projects/org/external');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ project: { management: 'external' }, state: null });
    expect(read).not.toHaveBeenCalled();
    await app.close();
  });
});
