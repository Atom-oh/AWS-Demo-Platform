import { PermanentError, MAX_SCALE_REPLICAS } from '@demo-platform/shared';
import type { ArgocdClient } from '@demo-platform/shared';

export interface ArgocdRestorationData {
  application: string;
  namespace: string;
  workloads: Record<string, number>;
  hpas: Record<string, { min: number; max: number }>;
}

export interface ArgocdControllerOpts {
  client: ArgocdClient;
}

export class ArgocdController {
  constructor(private readonly opts: ArgocdControllerOpts) {}

  async turnOff(args: { application: string; namespace: string }): Promise<ArgocdRestorationData> {
    const handles = await this.opts.client.listWorkloads(args.application, args.namespace);
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

    return { application: args.application, namespace: args.namespace, workloads, hpas };
  }

  async turnOn(rd: ArgocdRestorationData): Promise<void> {
    const handles = await this.opts.client.listWorkloads(rd.application, rd.namespace);
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

  // Dispatches per handle by kind: patchReplicas(replicas) for Deployment/
  // StatefulSet, patchHpaBounds({min:replicas, max:replicas}) for HPA — pinning
  // min=max to the requested count. HPA-kind handles are patched before
  // Deployment/StatefulSet-kind handles, carrying over turnOn/turnOff's "HPA
  // first, to prevent re-scaling" ordering convention. Zero matched handles
  // throws explicitly rather than resolving having silently done nothing, since
  // scale is the first feature where that silent no-op would look like success.
  //
  // For each HPA-kind handle, getLive is called BEFORE patchHpaBounds and its
  // pre-scale bounds are returned via capturedHpaBounds — the caller (job-runner)
  // persists this once as a permanent baseline (see StateClient.recordHpaBaselineIfAbsent)
  // so the original elasticity survives even though this call is about to collapse it.
  async scale(
    application: string,
    namespace: string,
    replicas: number,
  ): Promise<{ capturedHpaBounds: Record<string, { min: number; max: number }> }> {
    if (!Number.isInteger(replicas) || replicas <= 0 || replicas > MAX_SCALE_REPLICAS) {
      throw new PermanentError(
        `replicas must be a positive integer <= ${MAX_SCALE_REPLICAS}, got ${replicas}`,
      );
    }
    const handles = await this.opts.client.listWorkloads(application, namespace);
    if (handles.length === 0) {
      throw new PermanentError(
        `no workload handles found for ArgoCD application "${application}" — scale cannot proceed`,
      );
    }
    const capturedHpaBounds: Record<string, { min: number; max: number }> = {};
    for (const h of handles) {
      if (h.kind === 'HorizontalPodAutoscaler') {
        const live = await this.opts.client.getLive(application, h);
        if (typeof live.minReplicas === 'number' && typeof live.maxReplicas === 'number') {
          capturedHpaBounds[h.name] = { min: live.minReplicas, max: live.maxReplicas };
        }
        await this.opts.client.patchHpaBounds(application, h, { min: replicas, max: replicas });
      }
    }
    for (const h of handles) {
      if (h.kind === 'Deployment' || h.kind === 'StatefulSet') {
        await this.opts.client.patchReplicas(application, h, replicas);
      }
    }
    return { capturedHpaBounds };
  }
}
