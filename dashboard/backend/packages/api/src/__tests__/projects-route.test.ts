import { describe, it, expect, vi } from 'vitest';
import { buildServer } from '../server.js';
import type { Project } from '@demo-platform/shared';

const project: Project = {
  name: 'p',
  github: { repo: 'foo/bar', branch: 'main' },
  account: 'atomoh-main',
  resources: [{ type: 'ecs', cluster: 'c', service: 's' }],
};

describe('GET /api/projects', () => {
  it('returns list of project repos', async () => {
    const app = await buildServer({
      skipJwt: true,
      projects: { 'foo/bar': project },
      accounts: {},
      stateClient: { read: vi.fn(async () => null) } as never,
      jobsClient: { create: vi.fn(), read: vi.fn() } as never,
      sqsClient: { send: vi.fn() } as never,
      queueUrl: 'http://q',
      adminUsernames: ['atomoh'],
    });
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ repo: 'foo/bar', name: 'p', account: 'atomoh-main' }]);
    await app.close();
  });
});

describe('GET /api/projects/:repo', () => {
  it('returns project + current state', async () => {
    const app = await buildServer({
      skipJwt: true,
      projects: { 'foo/bar': project },
      accounts: {},
      stateClient: {
        read: vi.fn(async () => ({
          pk: 'project#foo/bar',
          sk: 'current',
          status: 'on',
          updated_at: '2026-05-28T00:00:00Z',
        })),
      } as never,
      jobsClient: { create: vi.fn(), read: vi.fn() } as never,
      sqsClient: { send: vi.fn() } as never,
      queueUrl: 'http://q',
      adminUsernames: ['atomoh'],
    });
    const res = await app.inject({ method: 'GET', url: '/api/projects/foo/bar' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.project.name).toBe('p');
    expect(body.state.status).toBe('on');
    await app.close();
  });

  it('returns 404 when unknown', async () => {
    const app = await buildServer({
      skipJwt: true,
      projects: {},
      accounts: {},
      stateClient: { read: vi.fn() } as never,
      jobsClient: { create: vi.fn(), read: vi.fn() } as never,
      sqsClient: { send: vi.fn() } as never,
      queueUrl: 'http://q',
      adminUsernames: ['atomoh'],
    });
    const res = await app.inject({ method: 'GET', url: '/api/projects/nope/x' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
