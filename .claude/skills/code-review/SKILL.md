# Code Review Skill

Review changed code with confidence-based scoring to filter false positives.

## Review Scope

By default, review unstaged changes from `git diff`. The user may specify different files or scope.

## Review Criteria

### Project Guidelines Compliance
- Terraform: module structure, variable naming, output exposure, backend configuration
- Kubernetes manifests: namespace placement, label/annotation conventions, resource limits
- ArgoCD Applications: project assignment, sync policy correctness, `ignoreDifferences` for HPA-2 pattern
- IAM policies: least-privilege, ExternalId enforcement on assume-role
- Naming and conventions from CLAUDE.md (`demo-platform-` prefix, `/demo-platform/` secret paths)

### Bug Detection
- Hardcoded ARNs/IDs that should be data-looked-up (e.g., the `*.atomai.click` cert)
- Missing tolerations for hub node taints (`workload-type=platform`, `node-role=system-critical`)
- SG ingress rules missing the CF VPC Origin source SG
- ExternalSecret using deprecated `v1beta1` instead of `v1`
- Atlantis deployment missing `--write-git-creds` flag
- Public ALB/NLB introduced (must be internal + CF-only)
- Kubernetes Ingress resource introduced (must use TGB instead)
- TF state collisions (cross-repo backend bucket sharing)

### Code Quality
- Duplicated Terraform across modules → suggest module extraction
- Manifest drift between azs (cart-az-a vs cart-az-c)
- Missing CLAUDE.md in new module
- Test coverage gaps for manifest validation

## Confidence Scoring

Rate each issue 0-100:
- **0-24**: Likely false positive or pre-existing. Do not report.
- **25-49**: Might be real but possibly a nitpick. Do not report.
- **50-74**: Real issue but minor. Report only if critical.
- **75-89**: Verified real issue, important. Report with fix suggestion.
- **90-100**: Confirmed critical issue. Must report.

**Only report issues with confidence >= 75.**

## Output Format

For each issue:
### [CRITICAL|IMPORTANT] <title> (confidence: XX)
**File:** `path/to/file.ext:line`
**Issue:** Clear description of the problem
**Guideline:** Reference to CLAUDE.md rule or AWS Well-Architected pillar
**Fix:** Concrete code suggestion

If no high-confidence issues found, confirm code meets standards with brief summary.
