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
    const rd = await c.turnOff({ application: 'app' });
    expect(rd.workloads).toEqual({ web: 3, cache: 2 });
    expect(rd.hpas).toEqual({ web: { min: 2, max: 10 } });
    expect(patchCalls).toContainEqual({ kind: 'HorizontalPodAutoscaler', name: 'web', payload: { min: 1, max: 1 } });
    expect(patchCalls).toContainEqual({ kind: 'Deployment', name: 'web', payload: { replicas: 1 } });
    expect(patchCalls).toContainEqual({ kind: 'StatefulSet', name: 'cache', payload: { replicas: 1 } });
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
      workloads: { web: 4 },
      hpas: { web: { min: 2, max: 10 } },
    });
    expect(patches).toContain('hpa:web=2-10');
    expect(patches).toContain('replicas:web=4');
  });
});
