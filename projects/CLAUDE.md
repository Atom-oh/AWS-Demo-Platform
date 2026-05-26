# projects/ Module

## Role
Per-project YAML metadata files. Each file describes a managed demo project: which AWS accounts it spans, which resources can be toggled on/off, where its dashboard data comes from (GitHub repo, ArgoCD app names, ECS service names), and any project-specific URLs (demo site, code-server).

## Conventions
- One file per project, named `<project-slug>.yaml` (matching the GitHub repo name where possible).
- Schema (informal for Stage 1; will be formalized in Stage 2 dashboard work):
  ```yaml
  name: multi-region-mall
  repo: Atom-oh/multi-region-architecture
  accounts:
    - atomoh-main
  argocd_apps:
    - workloads-apne2-az-a
    - workloads-apne2-az-c
  toggleable_resources:
    - kind: argocd-app
      name: workloads-apne2-az-a
    # ... ecs, rds, ec2 entries
  urls:
    demo: https://mall.atomai.click
    code_server: <ec2-derived>
  ```
- All ARNs and IDs should be looked up at runtime (by the future dashboard) rather than baked in.
- No secrets here — secret references go to Secrets Manager at `/demo-platform/projects/<slug>/...`.

## Rules
- Adding a project: create `<slug>.yaml`, then add matching `argocd-apps/tenants/<slug>.yaml` ArgoCD root Application.
- Removing a project: delete both files; ArgoCD will prune the workload (assuming `prune: true`).
- Changing toggleable resources requires updating the dashboard (Stage 3) — until then, document in this file.
