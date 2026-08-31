import type { ResourceRefT } from './schemas/project.js';

// Unique per-resource key so multiple resources of the same type (e.g. a project
// with two argocd-app entries) each keep their own restoration_data. The same key
// is used for the turn_off write and the turn_on read, so restoration is symmetric.
// Visibility-only types are skipped before this is called, so they fall to `type`.
export function stepKey(res: ResourceRefT): string {
  switch (res.type) {
    case 'ecs':
      return `ecs:${res.cluster}/${res.service}`;
    case 'ec2':
      return `ec2:${res.instance_ids.join(',')}`;
    case 'rds':
      return `rds:${res.db_identifier}`;
    case 'argocd-app':
      return `argocd-app:${res.application}`;
    default:
      return res.type;
  }
}

// The upper bound `scale` accepts for `replicas`/`desiredCount`, shared between
// the api route's request validation and the worker's controller-level guard so
// both sides check against the same number rather than two independently-chosen
// ceilings.
export const MAX_SCALE_REPLICAS = 20;
