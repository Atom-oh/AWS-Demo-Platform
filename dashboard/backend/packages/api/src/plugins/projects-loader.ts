import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import {
  ProjectSchema,
  AccountsFileSchema,
  type Project,
  type Account,
} from '@demo-platform/shared';

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
      throw new Error(`failed to parse ${e}: ${(err as Error).message}`);
    }
  }
  return out;
}

export async function loadAccounts(file: string): Promise<Record<string, Account>> {
  const raw = await fs.readFile(file, 'utf8');
  const parsed = AccountsFileSchema.parse(yaml.parse(raw));
  return Object.fromEntries(parsed.accounts.map((a) => [a.name, a]));
}
