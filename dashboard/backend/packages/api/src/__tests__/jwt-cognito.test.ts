import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerJwtCognito } from '../plugins/jwt-cognito.js';

const fakeVerifier = (returnUser: string | null) => ({
  verify: vi.fn(async (token: string) => {
    if (returnUser === null) throw new Error('invalid');
    return { 'cognito:username': returnUser, sub: 'sub-1' };
  }),
});

describe('JWT Cognito plugin', () => {
  it('rejects requests without Authorization header', async () => {
    const app = Fastify();
    await registerJwtCognito(app, {
      adminUsernames: ['atomoh'],
      verifier: fakeVerifier('atomoh') as never,
      skipPaths: ['/health'],
    });
    app.get('/protected', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
  });

  it('allows /health without auth', async () => {
    const app = Fastify();
    await registerJwtCognito(app, {
      adminUsernames: ['atomoh'],
      verifier: fakeVerifier('atomoh') as never,
      skipPaths: ['/health'],
    });
    app.get('/health', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('allows admin user, blocks non-admin', async () => {
    const app = Fastify();
    await registerJwtCognito(app, {
      adminUsernames: ['atomoh'],
      verifier: fakeVerifier('intruder') as never,
      skipPaths: [],
    });
    app.get('/protected', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer xxx' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('passes through when admin', async () => {
    const app = Fastify();
    await registerJwtCognito(app, {
      adminUsernames: ['atomoh'],
      verifier: fakeVerifier('atomoh') as never,
      skipPaths: [],
    });
    app.get('/protected', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer good' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('skipJwt mode bypasses entirely and injects atomoh', async () => {
    const app = Fastify();
    await registerJwtCognito(app, {
      adminUsernames: ['atomoh'],
      skipJwt: true,
      verifier: fakeVerifier('any') as never,
      skipPaths: [],
    });
    app.get('/whoami', async (req) => ({ user: (req as unknown as { user?: { username: string } }).user?.username }));
    const res = await app.inject({ method: 'GET', url: '/whoami' });
    expect(res.json()).toEqual({ user: 'atomoh' });
  });
});
