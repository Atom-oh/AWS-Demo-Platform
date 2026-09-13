---
name: code-review
description: Review project changes for evidenced defects using scoped repository contracts.
---

# Code review

Read root `CLAUDE.md`, the nearest module guide and `docs/pr-review.md`. Review the
requested diff (otherwise unstaged, then staged changes); record its base and head.

For each candidate, identify the changed path, a concrete failure condition and
supporting code or contract. Inspect relevant unchanged context before asserting a
guard is absent. Treat proposed safeguards and dated runtime observations as such.
An ADR can remain accepted while specific decisions are superseded; consult the
ADR index and scoped amendments. Confidence is evidence strength, not severity.

- Infrastructure: correct state/resource owner, target cluster, traffic path and
  rollout order. Tolerations match actual target taints. Replica/HPA ignore rules
  apply to lifecycle-controlled workloads, not all Applications.
- Security: credential exposure, relevant trust conditions and changed access.
  ExternalId applies to configured cross-account application roles; OIDC/IRSA use
  their own claims. Assess actual wildcards/conditions rather than banning all `*`.
- Code: validation, state transitions, persistence, recovery and user-visible errors.
  Verify compilation claims with the actual type checker when available.
- Documentation: current guides match code; historical records remain labeled;
  links work. Docs/comments/reviews are English; UI copy may remain Korean.

Report verified findings as CRITICAL/MAJOR/MINOR with confidence, path/line,
impact, evidence and a concrete fix. Report pre-existing issues, optional hardening
and review-coverage gaps separately. Do not require template sections, redundant
ADRs, adopted-resource renames or production HA solely by convention. Missing
context is an uncertainty to resolve, not proof of a blocker. Low confidence
(<75/100) candidates need verification before being reported as established defects.

No findings means none found within the stated coverage. It does not establish
runtime health, complete review or branch-protection compliance. Follow
`docs/runbooks/review-and-release.md` for the current-HEAD correction/merge loop.
