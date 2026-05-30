import { describe, it, expect } from 'vitest';
import { buildServer } from '../server.js';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = await buildServer({ skipJwt: true });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
    await app.close();
  });
});
