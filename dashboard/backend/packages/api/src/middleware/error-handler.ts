import type { FastifyInstance } from 'fastify';
import { TransientError, ConflictError, PermanentError } from '@demo-platform/shared';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ConflictError) {
      void reply.code(409).send({ error: err.message });
      return;
    }
    if (err instanceof TransientError) {
      void reply.code(503).send({ error: err.message });
      return;
    }
    if (err instanceof PermanentError) {
      void reply.code(400).send({ error: err.message });
      return;
    }
    // Fastify validation 400s pass through
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      void reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    void reply.code(500).send({ error: 'internal' });
  });
}
