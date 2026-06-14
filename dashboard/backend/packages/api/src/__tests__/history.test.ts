import { describe, it, expect, vi } from 'vitest';
import type { Project } from '@demo-platform/shared';
import { buildServer } from '../server.js';

const project: Project = {
  name: 'p',
  github: { repo: 'o/r', branch: 'main' },
  account: 'atomoh-main',
  resources: [{ type: 'ecs', cluster: 'c', service: 's' }],
};

// One raw HistoryClient record (full shape, incl. pk/ttl that must be stripped).
const rec = {
  pk: 'project#o/r',
  sk: '2026-06-14T09:00:00.000Z#abc-123',
  action: 'turn_off',
  actor: 'atomoh',
  account: 'atomoh-main',
  result: 'success' as const,
  details: { 'ecs:c/s': { original_desired_count: 3 } },
  ttl: 1789000000,
};

function server(listImpl = vi.fn(async () => [rec])) {
  const historyClient = { list: listImpl };
  // stateClient is required for buildServer to mount project routes.
  const stateClient = { read: vi.fn(async () => ({ status: 'on' })) };
  return buildServer({
    skipJwt: true,
    projects: { 'o/r': project },
    stateClient: stateClient as never,
    historyClient: historyClient as never,
  }).then((app) => ({ app, historyClient }));
}

describe('GET /api/projects/:owner/:name/history', () => {
  it('returns mapped records (ts from sk; no pk/ttl)', async () => {
    const { app } = await server();
    const res = await app.inject({ method: 'GET', url: '/api/projects/o/r/history' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.items).toEqual([
      {
        action: 'turn_off',
        actor: 'atomoh',
        account: 'atomoh-main',
        result: 'success',
        details: { 'ecs:c/s': { original_desired_count: 3 } },
        ts: '2026-06-14T09:00:00.000Z',
      },
    ]);
  });

  it('defaults limit to 20 and clamps invalid/negative to a valid positive int', async () => {
    const list = vi.fn(async () => []);
    const { app } = await server(list);
    await app.inject({ method: 'GET', url: '/api/projects/o/r/history' });
    expect(list).toHaveBeenLastCalledWith('o/r', 20);
    await app.inject({ method: 'GET', url: '/api/projects/o/r/history?limit=abc' });
    expect(list).toHaveBeenLastCalledWith('o/r', 20);
    await app.inject({ method: 'GET', url: '/api/projects/o/r/history?limit=-5' });
    expect(list).toHaveBeenLastCalledWith('o/r', 20);
    await app.inject({ method: 'GET', url: '/api/projects/o/r/history?limit=999' });
    expect(list).toHaveBeenLastCalledWith('o/r', 100);
    await app.inject({ method: 'GET', url: '/api/projects/o/r/history?limit=5' });
    expect(list).toHaveBeenLastCalledWith('o/r', 5);
  });

  it('404s for an unknown project', async () => {
    const { app } = await server();
    const res = await app.inject({ method: 'GET', url: '/api/projects/no/such/history' });
    expect(res.statusCode).toBe(404);
  });
});
