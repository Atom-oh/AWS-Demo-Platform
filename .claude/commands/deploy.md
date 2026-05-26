---
description: Deploy AWS Demo Platform changes (Atlantis for Terraform, ArgoCD for K8s)
allowed-tools: Read, Bash(git status:*), Bash(git push:*), Bash(argocd app sync:*), Bash(argocd app list:*), Glob
---

# Deploy

Deploy AWS Demo Platform changes. Deployment is split: Terraform → Atlantis, K8s → ArgoCD.

## Step 1: Pre-Deploy Checks

1. Verify working tree is clean: `git status`
2. Verify current branch is `main` (or warn)
3. Run `bash tests/run-all.sh`
4. Check if a relevant runbook exists: `ls docs/runbooks/`

## Step 2: Decide Deployment Path

**If only `infra/**/*.tf` changed:**
- Push to a feature branch, open a PR
- In the PR, comment `atlantis plan -d infra/<module>`
- Review the plan
- Comment `atlantis apply -d infra/<module>` to apply
- Merge after apply succeeds

**If only `k8s/**`, `argocd-apps/**`, or `projects/**` changed:**
- Push to `main` (or merge PR into `main`)
- ArgoCD on hub picks up changes via `targetRevision: main`
- Verify with `argocd app list` and `argocd app get <name>`
- Force sync if needed: `argocd app sync <name>`

**If both changed:**
- Land Terraform changes first via Atlantis
- Then land K8s changes (so manifests reference the new infra)

## Step 3: Verify

After deployment:
- Atlantis: check the PR comment for the `apply` output and final state
- ArgoCD: `argocd app list` — all apps should be `Synced` and `Healthy`
- End-to-end health:
  - `curl -sf https://atlantis.atomai.click/healthz` → 200
  - `curl -sf https://argocd.atomai.click/healthz` → 200

## Step 4: Summary

Display:
- What was deployed and where (Terraform module / ArgoCD Application)
- Deployment path used (Atlantis / ArgoCD)
- Verification results
- Suggest writing a runbook if this was a novel operation

## Error Recovery

### If pre-deploy checks fail (Step 1)
```bash
git stash
git checkout main
git pull --ff-only
```

### If Atlantis plan errors
- Read the Atlantis output in the PR comment
- Common causes: state lock (other apply in progress), backend access denied, IAM role drift
- Resolve and re-comment `atlantis plan`

### If ArgoCD sync fails
- `argocd app get <name>` shows the failed resource
- Common causes: SharedResourceWarning (old manifest in cluster), schema mismatch (CRD version), namespace finalizer stuck
- For SharedResourceWarning: add the new owner annotation or delete the orphaned resource
- For schema mismatch: check ArgoCD version supports the CRD spec

### Rollback
**Terraform:**
- Revert the PR (`git revert <sha>`), open new PR, atlantis apply
- Never use `terraform destroy` for rollback — write a forward fix

**K8s:**
- Revert the commit on `main`
- ArgoCD auto-syncs back to the previous state
- For self-managed ArgoCD: manual `helm rollback argocd <revision>` may be needed
