import { describe, it, expect, vi } from 'vitest';
import { GithubClient } from '../client.js';

describe('GithubClient', () => {
  it('lists repos in an org and filters by topic', async () => {
    const mockOctokit = {
      paginate: vi.fn(async () => [
        { full_name: 'Atom-oh/a', default_branch: 'main', topics: ['demo-platform'], description: '' },
        { full_name: 'Atom-oh/b', default_branch: 'main', topics: ['internal'], description: '' },
        { full_name: 'Atom-oh/c', default_branch: 'main', topics: ['demo-platform', 'workshop'], description: '' },
      ]),
      rest: { repos: { listForOrg: vi.fn() } },
    };

    const client = new GithubClient({
      pat: 'ghp_x',
      org: 'Atom-oh',
      octokit: mockOctokit as never,
    });
    const out = await client.listDemoRepos();
    expect(out.map((r) => r.full_name).sort()).toEqual(['Atom-oh/a', 'Atom-oh/c']);
  });

  it('returns all repos when topicFilter omitted', async () => {
    const mockOctokit = {
      paginate: vi.fn(async () => [
        { full_name: 'Atom-oh/a', default_branch: 'main', topics: [], description: '' },
        { full_name: 'Atom-oh/b', default_branch: 'main', topics: [], description: '' },
      ]),
      rest: { repos: { listForOrg: vi.fn() } },
    };
    const client = new GithubClient({ pat: 'p', org: 'Atom-oh', topicFilter: null, octokit: mockOctokit as never });
    const out = await client.listDemoRepos();
    expect(out).toHaveLength(2);
  });
});
