# Sync Docs Skill

Synchronize project documentation with current code state.

## Actions

### 1. Quality Assessment
Score each CLAUDE.md file (0-100) across:
- Commands/workflows (20 pts)
- Architecture clarity (20 pts)
- Non-obvious patterns (15 pts) — e.g., HPA-2, CF VPC Origin SG quirk
- Conciseness (15 pts)
- Currency (15 pts) — does it reflect the latest tag?
- Actionability (15 pts)

Apply anti-pattern deductions:
- Over 500 lines (-15)
- Vague instructions (-10)
- Duplicated docs (-10)
- No kube-context warning where cluster ops occur (-10)
- Contains secrets (-20)

Output quality report with grades (A-F) before making changes.

### 2. Root CLAUDE.md Sync
- Update Overview, Tech Stack, Conventions, Key Commands
- Verify commands are copy-paste ready against actual scripts
- Verify component versions match Helm chart values (ArgoCD 9.5.15, ESO 2.5.0)

### 3. Architecture Doc Sync
- Update `docs/architecture.md` to reflect current system structure
- Add new components, update data flows, reflect infrastructure changes
- Verify the ASCII diagram still shows the actual hub-spoke topology

### 4. Module CLAUDE.md Audit
- Scan `infra/`, `k8s/`, `argocd-apps/`, `dashboard/`, `projects/`
- Create `CLAUDE.md` for modules missing one
- Update existing module CLAUDE.md files if out of date
- Score each module CLAUDE.md

### 5. ADR and Runbook Audit
- Check recent commits for undocumented architectural decisions (HPA-2, CF VPC Origin, App-of-Apps were already locked in — they should each be an ADR)
- Verify runbook coverage: friend onboarding, ArgoCD recovery, Atlantis recovery, CF SG troubleshooting
- Flag stale ADRs and outdated runbooks

### 6. README.md Sync
- Update project structure section to match actual directory layout
- Verify both English and Korean sections stay in sync

### 7. Report
Output before/after quality scores, anti-patterns detected, and list of all changes.
