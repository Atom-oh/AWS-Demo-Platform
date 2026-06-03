import type { ProjectListItem, Project, Job } from './types';
import { getAccessToken } from './token-store';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  // Attach the Cognito ACCESS token (the api verifies tokenUse:'access'). The
  // same-origin /api/* rewrite/CloudFront behavior forwards the Authorization
  // header to the api. No token in dev (skipJwt) — header simply omitted.
  const headers = new Headers(opts?.headers);
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const r = await fetch(path, { ...opts, headers });
  if (!r.ok && r.status !== 202) {
    const body = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export const listProjects = () => req<ProjectListItem[]>('/api/projects');

export const getProject = (owner: string, name: string) =>
  req<{ project: Project; state: { status?: string } | null }>(
    `/api/projects/${owner}/${name}`,
  );

export const toggleProject = (owner: string, name: string, op: 'turn_on' | 'turn_off') =>
  req<{ job_id: string }>(`/api/projects/${owner}/${name}/actions/${op}`, { method: 'POST' });

export const getJob = (id: string) => req<Job>(`/api/jobs/${id}`);
