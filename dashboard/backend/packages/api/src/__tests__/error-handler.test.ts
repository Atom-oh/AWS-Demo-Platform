import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerErrorHandler } from '../middleware/error-handler.js';
import { TransientError, PermanentError, ConflictError } from '@demo-platform/shared';

function buildApp() {
  const app = Fastify();
  registerErrorHandler(app);
  app.get('/perm', async () => {
    throw new PermanentError('nope');
  });
  app.get('/trans', async () => {
    throw new TransientError('busy');
  });
  app.get('/conflict', async () => {
    throw new ConflictError('busy');
  });
  app.get('/unknown', async () => {
    throw new Error('boom');
  });
  return app;
}

describe('error handler', () => {
  it('maps PermanentError to 400', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/perm' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'nope' });
  });
  it('maps TransientError to 503', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/trans' });
    expect(res.statusCode).toBe(503);
  });
  it('maps ConflictError to 409', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/conflict' });
    expect(res.statusCode).toBe(409);
  });
  it('maps unknown to 500', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/unknown' });
    expect(res.statusCode).toBe(500);
  });
});
