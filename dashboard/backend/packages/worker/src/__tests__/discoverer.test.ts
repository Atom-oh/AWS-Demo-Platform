import { describe, it, expect, vi } from 'vitest';
import { runDiscovery } from '../discoverer.js';

describe('runDiscovery', () => {
  it('writes discovered repos to DDB meta record', async () => {
    const ghClient = {
      listDemoRepos: vi.fn(async () => [
        { full_name: 'Atom-oh/a', default_branch: 'main', topics: ['demo-platform'], description: '' },
      ]),
    };
    const docClient = { send: vi.fn(async () => ({})) };

    await runDiscovery({
      github: ghClient as never,
      doc: docClient as never,
      tableName: 'state-dev',
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    });

    expect(ghClient.listDemoRepos).toHaveBeenCalled();
    expect(docClient.send).toHaveBeenCalled();
    const cmd = docClient.send.mock.calls[0][0];
    expect((cmd as { input: { Item: { pk: string } } }).input.Item.pk).toBe('meta#discoverable');
  });

  it('writes error record on github failure', async () => {
    const ghClient = {
      listDemoRepos: vi.fn(async () => {
        throw new Error('401 Unauthorized');
      }),
    };
    const docClient = { send: vi.fn(async () => ({})) };
    await runDiscovery({
      github: ghClient as never,
      doc: docClient as never,
      tableName: 'state-dev',
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    });
    const cmd = docClient.send.mock.calls[0][0];
    expect((cmd as { input: { Item: { pk: string } } }).input.Item.pk).toBe('meta#discoverable_error');
  });
});
