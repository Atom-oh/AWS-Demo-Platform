import { describe, it, expect, vi } from 'vitest';
import { buildServer } from '../server.js';

describe('GET /api/jobs/:id', () => {
  it('returns job record', async () => {
    const app = await buildServer({
      skipJwt: true,
      projects: {},
      accounts: {},
      stateClient: { read: vi.fn() } as never,
      jobsClient: {
        read: vi.fn(async () => ({
          pk: 'job#j1',
          gsi1pk: 'project#foo/bar',
          gsi1sk: 't',
          operation: 'turn_off',
          status: 'running',
          progress: { ecs: 'done' },
          created_at: 't',
          ttl: 1,
        })),
        create: vi.fn(),
      } as never,
      sqsClient: { send: vi.fn() } as never,
      queueUrl: 'http://q',
      adminUsernames: ['atomoh'],
    });
    const res = await app.inject({ method: 'GET', url: '/api/jobs/j1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('running');
    expect(res.json().progress.ecs).toBe('done');
    await app.close();
  });

  it('returns 404 when job not found', async () => {
    const app = await buildServer({
      skipJwt: true,
      projects: {},
      accounts: {},
      stateClient: { read: vi.fn() } as never,
      jobsClient: { read: vi.fn(async () => null), create: vi.fn() } as never,
      sqsClient: { send: vi.fn() } as never,
      queueUrl: 'http://q',
      adminUsernames: ['atomoh'],
    });
    const res = await app.inject({ method: 'GET', url: '/api/jobs/nope' });
    expect(res.statusCode).toBe(404); // NotFoundError → 404
    await app.close();
  });
});
