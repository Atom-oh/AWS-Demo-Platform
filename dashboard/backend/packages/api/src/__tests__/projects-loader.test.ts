import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjects, loadAccounts, seedPlatformStates } from '../plugins/projects-loader.js';
import type { Project } from '@demo-platform/shared';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('loadProjects', () => {
  it('reads all yaml files in a dir and returns by repo', async () => {
    const projects = await loadProjects(path.join(fixturesDir, 'projects'));
    expect(projects['foo/a']?.name).toBe('a');
  });

  it('seeds only platform projects and preserves existing external bookkeeping', async () => {
    const base: Project = {
      name: 'p', github: { repo: 'org/platform', branch: 'main' },
      account: 'main', resources: [{ type: 'ecs', cluster: 'c', service: 's' }],
    };
    const state = { upsertInitial: vi.fn(async () => {}) };
    await seedPlatformStates({
      'org/platform': base,
      'org/external': { ...base, management: 'external' },
    }, state);
    expect(state.upsertInitial).toHaveBeenCalledOnce();
    expect(state.upsertInitial).toHaveBeenCalledWith('org/platform');
  });
});

describe('loadAccounts', () => {
  it('reads accounts file and returns by name', async () => {
    const accounts = await loadAccounts(path.join(fixturesDir, 'accounts.yaml'));
    expect(accounts['atomoh-main']?.account_id).toBe('111111111111');
  });
});
