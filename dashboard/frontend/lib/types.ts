export type Status = 'on' | 'off' | 'transitioning' | 'error' | 'unknown';

export interface ResourceRef {
  type: string;
  always_on?: boolean;
  [k: string]: unknown;
}

export interface Project {
  name: string;
  github: { repo: string; branch: string };
  description?: string;
  account: string;
  display?: { category?: string };
  resources: ResourceRef[];
  urls?: { demo?: string };
}

export interface ProjectListItem {
  repo: string;
  name: string;
  account: string;
}

export interface ProjectRow extends ProjectListItem {
  project: Project | null;
  status: Status;
}

export interface Job {
  id: string;
  operation: string;
  status: string;
  progress: Record<string, string>;
  error?: string;
}
