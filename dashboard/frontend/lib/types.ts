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
  urls?: {
    demo?: string;
    code_server?: { mode: 'explicit'; url: string } | { mode: 'ec2-tag'; tag: string };
  };
}

export interface HistoryRecord {
  action: string;
  actor: string;
  account: string;
  result: 'success' | 'partial' | 'failure';
  details?: Record<string, unknown>;
  ts: string; // ISO timestamp (mapped from the record sk by the api)
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
