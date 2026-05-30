import { PermanentError, TransientError } from '../errors.js';

export interface WorkloadHandle {
  kind: 'Deployment' | 'StatefulSet' | 'HorizontalPodAutoscaler';
  group: string;
  version: string;
  namespace: string;
  name: string;
}

export interface LiveState {
  replicas?: number;
  minReplicas?: number;
  maxReplicas?: number;
}

export interface ArgocdClientOpts {
  baseUrl: string;
  adminToken: string;
  namespace: string;
  fetchImpl?: typeof fetch;
}

const TARGET_KINDS = new Set(['Deployment', 'StatefulSet', 'HorizontalPodAutoscaler']);

export class ArgocdClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ArgocdClientOpts) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async req(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.opts.baseUrl}${path}`;
    const res = await this.fetchImpl(url, {
      ...init,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${this.opts.adminToken}`,
        ...(init?.headers ?? {}),
      },
    });
    if (res.status >= 500) throw new TransientError(`ArgoCD ${res.status} on ${path}`);
    if (res.status >= 400) {
      const body = await res.text();
      throw new PermanentError(`ArgoCD ${res.status} on ${path}: ${body}`);
    }
    return res;
  }

  async listWorkloads(app: string): Promise<WorkloadHandle[]> {
    const res = await this.req(`/api/v1/applications/${encodeURIComponent(app)}/resource-tree`);
    const data = (await res.json()) as { nodes?: Array<{
      kind: string;
      group?: string;
      version?: string;
      namespace?: string;
      name?: string;
    }> };
    return (data.nodes ?? [])
      .filter((n) => n.namespace === this.opts.namespace && TARGET_KINDS.has(n.kind))
      .map((n) => ({
        kind: n.kind as WorkloadHandle['kind'],
        group: n.group ?? '',
        version: n.version ?? '',
        namespace: n.namespace!,
        name: n.name!,
      }));
  }

  async getLive(app: string, h: WorkloadHandle): Promise<LiveState> {
    const qs = new URLSearchParams({
      namespace: h.namespace,
      resourceName: h.name,
      kind: h.kind,
      group: h.group,
      version: h.version,
    });
    const res = await this.req(`/api/v1/applications/${encodeURIComponent(app)}/resource?${qs}`);
    const data = (await res.json()) as { manifest?: string };
    if (!data.manifest) return {};
    const parsed = JSON.parse(data.manifest) as {
      spec?: { replicas?: number; minReplicas?: number; maxReplicas?: number };
    };
    return {
      replicas: parsed.spec?.replicas,
      minReplicas: parsed.spec?.minReplicas,
      maxReplicas: parsed.spec?.maxReplicas,
    };
  }

  async patchReplicas(app: string, h: WorkloadHandle, replicas: number): Promise<void> {
    const patch = JSON.stringify({ spec: { replicas } });
    await this.postPatch(app, h, patch);
  }

  async patchHpaBounds(
    app: string,
    h: WorkloadHandle,
    args: { min: number; max: number },
  ): Promise<void> {
    const patch = JSON.stringify({ spec: { minReplicas: args.min, maxReplicas: args.max } });
    await this.postPatch(app, h, patch);
  }

  private async postPatch(app: string, h: WorkloadHandle, patch: string): Promise<void> {
    const qs = new URLSearchParams({
      namespace: h.namespace,
      resourceName: h.name,
      kind: h.kind,
      group: h.group,
      version: h.version,
      patchType: 'application/strategic-merge-patch+json',
    });
    await this.req(`/api/v1/applications/${encodeURIComponent(app)}/resource?${qs}`, {
      method: 'POST',
      body: JSON.stringify({ patch }),
    });
  }
}
