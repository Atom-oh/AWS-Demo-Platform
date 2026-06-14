import type { FastifyInstance } from 'fastify';
import type { HistoryClient, Project } from '@demo-platform/shared';
import { NotFoundError } from '@demo-platform/shared';

export interface HistoryRouteDeps {
  projects: Record<string, Project>;
  historyClient: HistoryClient;
}

function parseLimit(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(n) || n < 1) return 20; // default for NaN / negative / missing
  return Math.min(n, 100); // DynamoDB Limit must be a positive int
}

export async function registerHistory(app: FastifyInstance, deps: HistoryRouteDeps): Promise<void> {
  app.get('/api/projects/:owner/:name/history', async (req) => {
    const { owner, name } = req.params as { owner: string; name: string };
    const repo = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
    if (!deps.projects[repo]) throw new NotFoundError(`project not found: ${repo}`);
    const limit = parseLimit((req.query as { limit?: string }).limit);
    const records = await deps.historyClient.list(repo, limit);
    // Map to a clean wire shape: ts from sk, drop pk/ttl.
    const items = records.map((r) => ({
      action: r.action,
      actor: r.actor,
      account: r.account,
      result: r.result,
      details: r.details,
      ts: r.sk.split('#')[0],
    }));
    return { items };
  });
}
