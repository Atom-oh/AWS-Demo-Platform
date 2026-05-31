import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import {
  ProjectSchema,
  AccountsFileSchema,
  createLogger,
  type Project,
  type Account,
} from '@demo-platform/shared';

const log = createLogger({ name: 'projects-loader' });

export async function loadProjects(dir: string): Promise<Record<string, Project>> {
  const entries = await fs.readdir(dir);
  const out: Record<string, Project> = {};
  for (const e of entries) {
    if (!e.endsWith('.yaml') && !e.endsWith('.yml')) continue;
    const raw = await fs.readFile(path.join(dir, e), 'utf8');
    try {
      const parsed = ProjectSchema.parse(yaml.parse(raw));
      out[parsed.github.repo] = parsed;
    } catch (err) {
      // Resilience: one malformed project yaml must not take the whole dashboard
      // down — log and skip it (PR-time lint is the first line of defense).
      log.warn({ file: e, err: (err as Error).message }, 'skipping invalid project yaml');
    }
  }
  return out;
}

export async function loadAccounts(file: string): Promise<Record<string, Account>> {
  const raw = await fs.readFile(file, 'utf8');
  const parsed = AccountsFileSchema.parse(yaml.parse(raw));
  return Object.fromEntries(parsed.accounts.map((a) => [a.name, a]));
}
