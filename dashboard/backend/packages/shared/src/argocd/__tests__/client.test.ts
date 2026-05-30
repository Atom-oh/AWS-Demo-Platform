import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArgocdClient, type WorkloadHandle } from '../client.js';

describe('ArgocdClient', () => {
  let calls: Array<{ url: string; method: string; body?: unknown }>;
  let mockFetch: typeof fetch;

  beforeEach(() => {
    calls = [];
    mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });

      if (url.endsWith('/api/v1/applications/myapp/resource-tree')) {
        return new Response(
          JSON.stringify({
            nodes: [
              {
                kind: 'Deployment',
                group: 'apps',
                version: 'v1',
                namespace: 'mall',
                name: 'web',
              },
              {
                kind: 'HorizontalPodAutoscaler',
                group: 'autoscaling',
                version: 'v2',
                namespace: 'mall',
                name: 'web',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (url.includes('/api/v1/applications/myapp/resource') && (init?.method ?? 'GET') === 'GET') {
        // returning a fake live manifest
        return new Response(
          JSON.stringify({
            manifest: JSON.stringify({
              spec: { replicas: 3, minReplicas: 2, maxReplicas: 10 },
            }),
          }),
          { status: 200 },
        );
      }

      if (url.includes('/api/v1/applications/myapp/resource') && init?.method === 'POST') {
        return new Response('{}', { status: 200 });
      }

      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
  });

  it('lists workload handles from resource-tree', async () => {
    const client = new ArgocdClient({
      baseUrl: 'https://argocd.test',
      adminToken: 't',
      namespace: 'mall',
      fetchImpl: mockFetch,
    });
    const handles = await client.listWorkloads('myapp');
    expect(handles).toHaveLength(2);
    const dep = handles.find((h) => h.kind === 'Deployment');
    expect(dep?.name).toBe('web');
  });

  it('fetches replicas for a Deployment', async () => {
    const client = new ArgocdClient({
      baseUrl: 'https://argocd.test',
      adminToken: 't',
      namespace: 'mall',
      fetchImpl: mockFetch,
    });
    const h: WorkloadHandle = {
      kind: 'Deployment',
      group: 'apps',
      version: 'v1',
      namespace: 'mall',
      name: 'web',
    };
    const live = await client.getLive('myapp', h);
    expect(live.replicas).toBe(3);
  });

  it('patches workload replicas via POST resource', async () => {
    const client = new ArgocdClient({
      baseUrl: 'https://argocd.test',
      adminToken: 't',
      namespace: 'mall',
      fetchImpl: mockFetch,
    });
    const h: WorkloadHandle = {
      kind: 'Deployment',
      group: 'apps',
      version: 'v1',
      namespace: 'mall',
      name: 'web',
    };
    await client.patchReplicas('myapp', h, 1);
    const post = calls.find((c) => c.method === 'POST');
    expect(post).toBeDefined();
    expect(post?.body).toMatchObject({ patch: expect.stringContaining('"replicas":1') });
  });
});
