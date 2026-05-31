import type { FastifyInstance } from 'fastify';
import type { JobsClient } from '@demo-platform/shared';
import { NotFoundError } from '@demo-platform/shared';

export interface JobsRouteDeps {
  jobsClient: JobsClient;
}

export async function registerJobs(app: FastifyInstance, deps: JobsRouteDeps): Promise<void> {
  app.get('/api/jobs/:id', async (req) => {
    const { id } = req.params as { id: string };
    const rec = await deps.jobsClient.read(id);
    if (!rec) throw new NotFoundError(`job not found: ${id}`);
    return {
      id,
      operation: rec.operation,
      status: rec.status,
      progress: rec.progress,
      error: rec.error,
      created_at: rec.created_at,
      started_at: rec.started_at,
      completed_at: rec.completed_at,
    };
  });
}
