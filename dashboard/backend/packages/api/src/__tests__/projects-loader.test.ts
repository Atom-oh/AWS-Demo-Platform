import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjects, loadAccounts } from '../plugins/projects-loader.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('loadProjects', () => {
  it('reads all yaml files in a dir and returns by repo', async () => {
    const projects = await loadProjects(path.join(fixturesDir, 'projects'));
    expect(projects['foo/a']?.name).toBe('a');
  });
});

describe('loadAccounts', () => {
  it('reads accounts file and returns by name', async () => {
    const accounts = await loadAccounts(path.join(fixturesDir, 'accounts.yaml'));
    expect(accounts['atomoh-main']?.account_id).toBe('111111111111');
  });
});
