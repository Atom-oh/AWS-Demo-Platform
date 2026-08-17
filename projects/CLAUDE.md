# projects/ Module

## Role
Per-project YAML metadata files. Each file describes a managed demo project: which AWS accounts it spans, which resources can be toggled on/off, where its dashboard data comes from (GitHub repo, ArgoCD app names, ECS service names), and any project-specific URLs (demo site, code-server).

## Conventions
Each project gets one file, named `<project-slug>.yaml`, matching the GitHub repo name where possible so the mapping between a project entry and its source repo stays obvious at a glance.

The schema is formalized as a Zod discriminated union in `dashboard/backend/packages/shared/src/schemas/project.ts` — `name`, a `github` block (`repo`, `branch`), `account`, an optional `display.category`, a `resources` list of typed entries discriminated by `type` (`ecs`, `ec2`, `argocd-app`, `rds`, `dynamodb`, `elasticache`, `kafka`, `msk`, `stepfunctions`, `lambda`, `firehose` — several of these are `always_on: true` visibility-only, with no toggle path), and an optional `urls` block (`demo`, `code_server`). The representative file, `multi-region-mall.yaml`, uses `github.repo: Atom-oh/multi-region-architecture`, `account: atomoh-main`, two `argocd-app` resources (`workloads-apne2-az-a`/`-az-c`, each with `hpa_handling: scale_to_one`), three always-on data-layer resources (`rds`/`elasticache`/`msk`), and `urls.demo: https://mall.atomai.click`.

ARNs and IDs are meant to be looked up at runtime by the future dashboard rather than baked into these files, since baked-in identifiers would drift out of sync with the actual AWS resources. Secrets have no place here either — secret references belong in Secrets Manager under `/demo-platform/projects/<slug>/...`, with this file only ever pointing at that path rather than holding a value.

Onboarding a project means creating `<slug>.yaml` here and pairing it with a matching `argocd-apps/tenants/<slug>.yaml` ArgoCD root Application, since the two files together are what let ArgoCD discover and manage the project's workload. Retiring a project is the reverse: deleting both files lets ArgoCD prune the workload, as long as `prune: true` is set for that Application. The `resources` list is live — the Stage 2 backend's worker toggles each entry on/off and the Stage 3 frontend MVP exposes that as a working on/off control per project — so a schema change here needs to stay in step with `project.ts`.
