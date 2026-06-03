# MRA mgmt-manifest migration — Design

**Date**: 2026-06-03
**Status**: Implemented
**Goal**: Make AWS-Demo-Platform the sole git source for all hub mgmt-cluster k8s manifests; sever the remaining `multi-region-architecture` (MRA) git dependency for system components.

## Context

After Stage 1, most hub system components were already AppSets in AWS-Demo-Platform sourcing Helm chart repos directly (argocd, atlantis, external-secrets, CSS, alb-controller, ARC + runners, karpenter chart, clickhouse-operator, otel, prometheus). Four AppSets still sourced **manifests** from MRA git, and the runner AppSets referenced MRA only as a `githubConfigUrl` runner-target value (not a manifest source — left unchanged).

## Scope

In: copy 4 component manifest sets MRA `k8s/infra/*` → AWS-Demo-Platform `k8s/system/*` (faithful) and repoint their AppSets.

| Component | MRA path → local | AppSet | repoURL + path change |
|---|---|---|---|
| grafana dashboards | `k8s/infra/grafana` → `k8s/system/grafana` | `grafana-dashboards` | MRA→ADP, path→k8s/system/grafana |
| storageclass | `k8s/infra/storageclass` → `k8s/system/storageclass` | `storageclass` | MRA→ADP, path→k8s/system/storageclass |
| runner-scheduler | `k8s/infra/runner-scheduler` → `k8s/system/runner-scheduler` | `runner-scheduler` | MRA→ADP, path→k8s/system/runner-scheduler |
| karpenter (base + az-a/az-c/mgmt overlays) | `k8s/infra/karpenter*` → `k8s/system/karpenter*` | `infra-karpenter-crds` | MRA→ADP, karpenterPath→k8s/system/karpenter-apne2-* |

Out: tenant workloads (`workloads-apne2-*` — stay in MRA per hub-spoke design), runner `githubConfigUrl` values, MRA git deletion (separate later), Terraform (`eks-mgmt` already migrated in Stage 1).

## Cutover

Single PR: faithful copy + repoint. Manifests are byte-identical to MRA, so on merge `master-system-root` syncs the updated AppSets and ArgoCD re-syncs identical content from the new source (ServerSideApply) — no resource churn. Validated each dir with `kubectl kustomize` (karpenter overlays use `--load-restrictor LoadRestrictionsNone`, already enabled cluster-wide in `argocd-cm`); `k8s/system/grafana` renders identically to MRA.

## Risks / notes

- Karpenter overlays reference the sibling `../karpenter` base — base copied alongside; sibling layout preserved.
- `actions-runner` (namespace + placeholder secret) is not referenced by any ADP AppSet — not migrated.
- MRA dirs remain after this PR (harmless; nothing sources them once repointed). MRA cleanup is a separate optional PR.

## DoD

- ArgoCD apps `grafana-dashboards`, `storageclass-*`, `runner-scheduler`, `infra-karpenter-crds-*` Synced+Healthy, sourced from AWS-Demo-Platform.
- 0 hub system apps sourced from MRA git (only the 2 tenant `workloads-apne2-*` remain, by design).
