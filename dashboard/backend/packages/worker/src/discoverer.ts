import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { GithubClient, Logger } from '@demo-platform/shared';

export interface DiscoveryOpts {
  github: GithubClient;
  doc: DynamoDBDocumentClient;
  tableName: string;
  logger: Logger;
}

export async function runDiscovery(opts: DiscoveryOpts): Promise<void> {
  const now = new Date().toISOString();
  try {
    const repos = await opts.github.listDemoRepos();
    opts.logger.info({ count: repos.length }, 'github discovery succeeded');
    await opts.doc.send(
      new PutCommand({
        TableName: opts.tableName,
        Item: {
          pk: 'meta#discoverable',
          sk: 'current',
          repos: repos.map((r) => ({ full_name: r.full_name, default_branch: r.default_branch, topics: r.topics, description: r.description })),
          updated_at: now,
        },
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts.logger.error({ err }, 'github discovery failed');
    await opts.doc.send(
      new PutCommand({
        TableName: opts.tableName,
        Item: {
          pk: 'meta#discoverable_error',
          sk: 'current',
          error: msg,
          updated_at: now,
        },
      }),
    );
  }
}

export function startDiscoveryCron(opts: DiscoveryOpts, intervalMs: number = 60 * 60 * 1000): () => void {
  let stopped = false;
  // immediate run
  void runDiscovery(opts);
  const t = setInterval(() => {
    if (!stopped) void runDiscovery(opts);
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(t);
  };
}
