import { describe, it, expect, vi } from 'vitest';
import { buildServer } from '../server.js';
import type { Project } from '@demo-platform/shared';

const project: Project = {
  name: 'p',
  github: { repo: 'foo/bar', branch: 'main' },
  account: 'atomoh-main',
  resources: [{ type: 'ecs', cluster: 'c', service: 's' }],
};

describe('POST /api/projects/:repo/actions/turn_off', () => {
  it('rejects when state is not on (409)', async () => {
    const app = await buildServer({
      skipJwt: true,
      projects: { 'foo/bar': project },
      accounts: {},
      stateClient: {
        read: vi.fn(async () => ({
          pk: 'project#foo/bar',
          sk: 'current',
          status: 'off',
          restoration_data: { ecs: { cluster: 'c', service: 's', original_desired_count: 1 } },
          updated_at: 't',
        })),
        transition: vi.fn(),
      } as never,
      jobsClient: { create: vi.fn(async () => 'j1') } as never,
      sqsClient: { send: vi.fn(async () => ({})) } as never,
      queueUrl: 'http://q',
      adminUsernames: ['atomoh'],
    });
    const res = await app.inject({ method: 'POST', url: '/api/projects/foo/bar/actions/turn_off' });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('enqueues job and returns 202 with job_id', async () => {
    const transitionMock = vi.fn();
    const createMock = vi.fn(async () => 'j-new');
    const sendMock = vi.fn(async () => ({}));
    const app = await buildServer({
      skipJwt: true,
      projects: { 'foo/bar': project },
      accounts: {},
      stateClient: {
        read: vi.fn(async () => ({
          pk: 'project#foo/bar',
          sk: 'current',
          status: 'on',
          updated_at: 't',
        })),
        transition: transitionMock,
      } as never,
      jobsClient: { create: createMock, read: vi.fn() } as never,
      sqsClient: { send: sendMock } as never,
      queueUrl: 'http://q',
      adminUsernames: ['atomoh'],
    });
    const res = await app.inject({ method: 'POST', url: '/api/projects/foo/bar/actions/turn_off' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ job_id: 'j-new' });
    expect(transitionMock).toHaveBeenCalledWith('foo/bar', expect.objectContaining({ from: 'on', to: 'transitioning' }));
    expect(sendMock).toHaveBeenCalled();
    await app.close();
  });
});
