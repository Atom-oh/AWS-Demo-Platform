# projects/ Module

## Role
Per-project YAML metadata files. Each file describes a managed demo project: which AWS accounts it spans, which resources can be toggled on/off, where its dashboard data comes from (GitHub repo, ArgoCD app names, ECS service names), and any project-specific URLs (demo site, code-server).

## Conventions
Each project gets one file, named `<project-slug>.yaml`, matching the GitHub repo name where possible so the mapping between a project entry and its source repo stays obvious at a glance.

The schema is informal for Stage 1 and will be formalized once the Stage 2 dashboard work needs a stricter contract. A representative file, `multi-region-mall.yaml`, carries a `name` (`multi-region-mall`), a `repo` (`Atom-oh/multi-region-architecture`), an `accounts` list (`atomoh-main`), an `argocd_apps` list (`workloads-apne2-az-a`, `workloads-apne2-az-c`), a `toggleable_resources` list of typed entries (an `argocd-app` entry named `workloads-apne2-az-a`, plus further entries for ecs/rds/ec2 kinds), and a `urls` block with `demo` (`https://mall.atomai.click`) and `code_server` (derived from the EC2 instance).

ARNs and IDs are meant to be looked up at runtime by the future dashboard rather than baked into these files, since baked-in identifiers would drift out of sync with the actual AWS resources. Secrets have no place here either — secret references belong in Secrets Manager under `/demo-platform/projects/<slug>/...`, with this file only ever pointing at that path rather than holding a value.

Onboarding a project means creating `<slug>.yaml` here and pairing it with a matching `argocd-apps/tenants/<slug>.yaml` ArgoCD root Application, since the two files together are what let ArgoCD discover and manage the project's workload. Retiring a project is the reverse: deleting both files lets ArgoCD prune the workload, as long as `prune: true` is set for that Application. Because toggleable resources aren't yet wired into a dashboard (that lands in Stage 3), any change to what's toggleable should be documented in this file in the meantime so the intent isn't lost.
