import type { ArgocdClient, WorkloadHandle } from '@demo-platform/shared';

export interface ArgocdRestorationData {
  application: string;
  workloads: Record<string, number>;
  hpas: Record<string, { min: number; max: number }>;
}

export interface ArgocdControllerOpts {
  client: ArgocdClient;
}

export class ArgocdController {
  constructor(private readonly opts: ArgocdControllerOpts) {}

  async turnOff(args: { application: string }): Promise<ArgocdRestorationData> {
    const handles = await this.opts.client.listWorkloads(args.application);
    const workloads: Record<string, number> = {};
    const hpas: Record<string, { min: number; max: number }> = {};

    // Capture current state
    for (const h of handles) {
      const live = await this.opts.client.getLive(args.application, h);
      if (h.kind === 'Deployment' || h.kind === 'StatefulSet') {
        if (typeof live.replicas === 'number') workloads[h.name] = live.replicas;
      } else if (h.kind === 'HorizontalPodAutoscaler') {
        if (typeof live.minReplicas === 'number' && typeof live.maxReplicas === 'number') {
          hpas[h.name] = { min: live.minReplicas, max: live.maxReplicas };
        }
      }
    }

    // Apply turn-off: HPA first (to prevent re-scaling), then Deploy/STS
    for (const h of handles) {
      if (h.kind === 'HorizontalPodAutoscaler' && hpas[h.name]) {
        await this.opts.client.patchHpaBounds(args.application, h, { min: 1, max: 1 });
      }
    }
    for (const h of handles) {
      if ((h.kind === 'Deployment' || h.kind === 'StatefulSet') && workloads[h.name] !== undefined) {
        if (workloads[h.name] !== 1) {
          await this.opts.client.patchReplicas(args.application, h, 1);
        }
      }
    }

    return { application: args.application, workloads, hpas };
  }

  async turnOn(rd: ArgocdRestorationData): Promise<void> {
    const handles = await this.opts.client.listWorkloads(rd.application);
    // Reverse: HPA bounds first, then replica restore
    for (const h of handles) {
      const b = rd.hpas[h.name];
      if (h.kind === 'HorizontalPodAutoscaler' && b) {
        await this.opts.client.patchHpaBounds(rd.application, h, b);
      }
    }
    for (const h of handles) {
      const replicas = rd.workloads[h.name];
      if ((h.kind === 'Deployment' || h.kind === 'StatefulSet') && replicas !== undefined) {
        await this.opts.client.patchReplicas(rd.application, h, replicas);
      }
    }
  }
}
