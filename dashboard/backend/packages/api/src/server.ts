import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealth } from './routes/health.js';

export interface BuildServerOpts {
  skipJwt?: boolean;
}

export async function buildServer(opts: BuildServerOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerHealth(app);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8080);
  buildServer().then(async (app) => {
    await app.listen({ port, host: '0.0.0.0' });
    // eslint-disable-next-line no-console
    console.log(`api listening on :${port}`);
  });
}
