# ADR-002: Control ArgoCD Applications via REST API, not the Kubernetes API

**Status:** Accepted (Stage 2, 2026-05-28)
**Context spec:** `docs/superpowers/specs/2026-05-28-stage-2-lifecycle-controller-design.md`

## Context

The worker's ArgoCD controller implements the HPA-2 on/off pattern: read the
workloads under an Application, capture replicas / HPA min-max, then patch
Deployment `replicas=1` and HPA `min=max=1` (and reverse on turn_on). It can
reach the cluster two ways:

1. **Kubernetes API directly** — the ECS task role authenticates to the hub EKS
   cluster (`eks:DescribeCluster` + aws-auth mapping) and patches the workloads.
2. **ArgoCD REST API** — call `/api/v1/applications/:app/resource-tree` and the
   resource GET/POST-patch endpoints with an ArgoCD admin token.

## Decision

**Option 2 (ArgoCD REST API).** The worker uses an ArgoCD API token
(`/demo-platform/argocd/admin-token` in Secrets Manager) and operates through
ArgoCD's resource endpoints.

Rationale:
- Single credential to manage (the ArgoCD token), versus wiring the ECS task
  role into every spoke cluster's `aws-auth`.
- Actions go through ArgoCD, so they behave identically to a human using the
  ArgoCD UI and are visible there.
- Avoids per-cluster Kubernetes RBAC plumbing as spokes are added.

## Consequences

- Slightly higher latency than direct k8s API calls (acceptable for an admin
  tool).
- Token lifecycle is manual in v0.X (rotate by hand). A dedicated ArgoCD service
  account with a managed token is deferred to Stage 4.
- `eks:DescribeCluster` is still granted to the task role for a future direct-k8s
  fallback, but is unused by this path today.
