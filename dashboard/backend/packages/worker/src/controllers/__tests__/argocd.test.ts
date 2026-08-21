import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArgocdController } from '../argocd.js';
import type { ArgocdClient, WorkloadHandle, LiveState } from '@demo-platform/shared';

describe('ArgocdController.turnOff', () => {
  let workloads: WorkloadHandle[];
  let liveByKey: Map<string, LiveState>;
  let patchCalls: Array<{ kind: string; name: string; payload: Record<string, unknown> }>;
  let argoClient: Pick<ArgocdClient, 'listWorkloads' | 'getLive' | 'patchReplicas' | 'patchHpaBounds'>;

  beforeEach(() => {
    workloads = [
      { kind: 'Deployment', group: 'apps', version: 'v1', namespace: 'ns', name: 'web' },
      { kind: 'StatefulSet', group: 'apps', version: 'v1', namespace: 'ns', name: 'cache' },
      {
        kind: 'HorizontalPodAutoscaler',
        group: 'autoscaling',
        version: 'v2',
        namespace: 'ns',
        name: 'web',
      },
    ];
    liveByKey = new Map<string, LiveState>([
      ['Deployment/web', { replicas: 3 }],
      ['StatefulSet/cache', { replicas: 2 }],
      ['HorizontalPodAutoscaler/web', { minReplicas: 2, maxReplicas: 10 }],
    ]);
    patchCalls = [];
    argoClient = {
      listWorkloads: vi.fn(async () => workloads),
      getLive: vi.fn(async (_app, h) => liveByKey.get(`${h.kind}/${h.name}`) ?? {}),
      patchReplicas: vi.fn(async (_app, h, r) => {
        patchCalls.push({ kind: h.kind, name: h.name, payload: { replicas: r } });
      }),
      patchHpaBounds: vi.fn(async (_app, h, b) => {
        patchCalls.push({ kind: h.kind, name: h.name, payload: b });
      }),
    };
  });

  it('captures replicas/bounds, then scales to 1 + HPA(1,1)', async () => {
    const c = new ArgocdController({ client: argoClient as unknown as ArgocdClient });
    const rd = await c.turnOff({ application: 'app', namespace: 'ns' });
    expect(rd.workloads).toEqual({ web: 3, cache: 2 });
    expect(rd.hpas).toEqual({ web: { min: 2, max: 10 } });
    expect(patchCalls).toContainEqual({ kind: 'HorizontalPodAutoscaler', name: 'web', payload: { min: 1, max: 1 } });
    expect(patchCalls).toContainEqual({ kind: 'Deployment', name: 'web', payload: { replicas: 1 } });
    expect(patchCalls).toContainEqual({ kind: 'StatefulSet', name: 'cache', payload: { replicas: 1 } });
  });

  it('passes the namespace through to listWorkloads', async () => {
    const c = new ArgocdController({ client: argoClient as unknown as ArgocdClient });
    await c.turnOff({ application: 'app', namespace: 'ns' });
    expect(argoClient.listWorkloads).toHaveBeenCalledWith('app', 'ns');
  });
});

describe('ArgocdController.turnOn', () => {
  it('restores replicas + hpa bounds from restoration_data', async () => {
    const workloads: WorkloadHandle[] = [
      { kind: 'Deployment', group: 'apps', version: 'v1', namespace: 'ns', name: 'web' },
      {
        kind: 'HorizontalPodAutoscaler',
        group: 'autoscaling',
        version: 'v2',
        namespace: 'ns',
        name: 'web',
      },
    ];
    const patches: string[] = [];
    const client: Pick<ArgocdClient, 'listWorkloads' | 'patchReplicas' | 'patchHpaBounds' | 'getLive'> = {
      listWorkloads: vi.fn(async () => workloads),
      getLive: vi.fn(async () => ({})),
      patchReplicas: vi.fn(async (_a, h, r) => {
        patches.push(`replicas:${h.name}=${r}`);
      }),
      patchHpaBounds: vi.fn(async (_a, h, b) => {
        patches.push(`hpa:${h.name}=${b.min}-${b.max}`);
      }),
    };

    const c = new ArgocdController({ client: client as unknown as ArgocdClient });
    await c.turnOn({
      application: 'app',
      namespace: 'ns',
      workloads: { web: 4 },
      hpas: { web: { min: 2, max: 10 } },
    });
    expect(patches).toContain('hpa:web=2-10');
    expect(patches).toContain('replicas:web=4');
    expect(client.listWorkloads).toHaveBeenCalledWith('app', 'ns');
  });
});

describe('ArgocdController.scale', () => {
  function makeClient(workloads: WorkloadHandle[]) {
    const calls: Array<{ kind: string; name: string; at: number }> = [];
    let seq = 0;
    const client: Pick<ArgocdClient, 'listWorkloads' | 'patchReplicas' | 'patchHpaBounds' | 'getLive'> = {
      listWorkloads: vi.fn(async () => workloads),
      getLive: vi.fn(async () => ({})),
      patchReplicas: vi.fn(async (_a, h) => {
        calls.push({ kind: h.kind, name: h.name, at: seq++ });
      }),
      patchHpaBounds: vi.fn(async (_a, h) => {
        calls.push({ kind: h.kind, name: h.name, at: seq++ });
      }),
    };
    return { client, calls };
  }

  it('(a) replica-bearing handles (Deployment + StatefulSet) get patchReplicas, never patchHpaBounds', async () => {
    const workloads: WorkloadHandle[] = [
      { kind: 'Deployment', group: 'apps', version: 'v1', namespace: 'ns', name: 'web' },
      { kind: 'StatefulSet', group: 'apps', version: 'v1', namespace: 'ns', name: 'cache' },
    ];
    const { client } = makeClient(workloads);
    const c = new ArgocdController({ client: client as unknown as ArgocdClient });
    await c.scale('app', 'ns', 5);
    expect(client.patchReplicas).toHaveBeenCalledWith('app', workloads[0], 5);
    expect(client.patchReplicas).toHaveBeenCalledWith('app', workloads[1], 5);
    expect(client.patchHpaBounds).not.toHaveBeenCalled();
  });

  it('(b) only HPA-kind handles get patchHpaBounds({min,max}), never patchReplicas', async () => {
    const workloads: WorkloadHandle[] = [
      { kind: 'HorizontalPodAutoscaler', group: 'autoscaling', version: 'v2', namespace: 'ns', name: 'web' },
    ];
    const { client } = makeClient(workloads);
    const c = new ArgocdController({ client: client as unknown as ArgocdClient });
    await c.scale('app', 'ns', 5);
    expect(client.patchHpaBounds).toHaveBeenCalledWith('app', workloads[0], { min: 5, max: 5 });
    expect(client.patchReplicas).not.toHaveBeenCalled();
  });

  it('(c) mixed kinds: each handle gets the call matching its kind, HPA patched before Deployment/StatefulSet', async () => {
    const workloads: WorkloadHandle[] = [
      { kind: 'Deployment', group: 'apps', version: 'v1', namespace: 'ns', name: 'web' },
      { kind: 'StatefulSet', group: 'apps', version: 'v1', namespace: 'ns', name: 'cache' },
      { kind: 'HorizontalPodAutoscaler', group: 'autoscaling', version: 'v2', namespace: 'ns', name: 'web' },
    ];
    const { client, calls } = makeClient(workloads);
    const c = new ArgocdController({ client: client as unknown as ArgocdClient });
    await c.scale('app', 'ns', 3);
    expect(client.patchReplicas).toHaveBeenCalledWith('app', workloads[0], 3);
    expect(client.patchReplicas).toHaveBeenCalledWith('app', workloads[1], 3);
    expect(client.patchHpaBounds).toHaveBeenCalledWith('app', workloads[2], { min: 3, max: 3 });
    const hpaCall = calls.find((x) => x.kind === 'HorizontalPodAutoscaler');
    const deployCalls = calls.filter((x) => x.kind === 'Deployment' || x.kind === 'StatefulSet');
    expect(hpaCall).toBeDefined();
    for (const dc of deployCalls) {
      expect(hpaCall!.at).toBeLessThan(dc.at);
    }
  });

  it('(d) zero matched handles throws/rejects rather than resolving successfully', async () => {
    const { client } = makeClient([]);
    const c = new ArgocdController({ client: client as unknown as ArgocdClient });
    await expect(c.scale('app', 'ns', 3)).rejects.toThrow();
  });

  it('captures pre-scale HPA bounds via getLive before patching, keyed by handle name', async () => {
    const workloads: WorkloadHandle[] = [
      { kind: 'HorizontalPodAutoscaler', group: 'autoscaling', version: 'v2', namespace: 'ns', name: 'web' },
    ];
    const calls: string[] = [];
    const client: Pick<ArgocdClient, 'listWorkloads' | 'patchReplicas' | 'patchHpaBounds' | 'getLive'> = {
      listWorkloads: vi.fn(async () => workloads),
      getLive: vi.fn(async () => {
        calls.push('getLive');
        return { minReplicas: 2, maxReplicas: 10 };
      }),
      patchReplicas: vi.fn(async () => {
        calls.push('patchReplicas');
      }),
      patchHpaBounds: vi.fn(async () => {
        calls.push('patchHpaBounds');
      }),
    };
    const c = new ArgocdController({ client: client as unknown as ArgocdClient });
    const { capturedHpaBounds } = await c.scale('app', 'ns', 5);
    expect(capturedHpaBounds).toEqual({ web: { min: 2, max: 10 } });
    expect(calls.indexOf('getLive')).toBeLessThan(calls.indexOf('patchHpaBounds'));
  });

  it('rejects a non-integer, non-positive, or over-ceiling replicas value before calling the client', async () => {
    const workloads: WorkloadHandle[] = [
      { kind: 'Deployment', group: 'apps', version: 'v1', namespace: 'ns', name: 'web' },
    ];
    const { client } = makeClient(workloads);
    const c = new ArgocdController({ client: client as unknown as ArgocdClient });
    await expect(c.scale('app', 'ns', 0)).rejects.toThrow();
    await expect(c.scale('app', 'ns', 2.5)).rejects.toThrow();
    await expect(c.scale('app', 'ns', 21)).rejects.toThrow();
    expect(client.patchReplicas).not.toHaveBeenCalled();
  });
});
