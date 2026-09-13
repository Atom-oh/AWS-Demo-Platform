---
name: sync-docs
description: Reconcile project documentation with code and synchronize generated reviewer context.
---

# Synchronize documentation

Use `docs/README.md` as the document map. Compare root/module guides, architecture,
onboarding and affected runbooks against source/configuration before editing.
Versions come from manifests; release tags do not prove runtime state.

1. Identify contradictions, broken paths, stale commands and duplicated prose.
   Report evidence and prioritize details that change implementation/review decisions.
2. Update current guides in English. Preserve the distinction between documentation
   language and Korean product UI. Keep one owner per fact and link to details.
3. Check ADR scope and dated amendments. Mark superseded portions explicitly;
   do not call a whole ADR obsolete when only its roster/topology changed.
4. Keep historical plans/specs labeled and concise, with current-source links.
   Preserve decision rationale; original code transcripts remain in Git history.
5. Update README/changelog where behavior changed. Do not add bilingual copies.
6. Regenerate root `AGENTS.md` from `CLAUDE.md` with `/co-agent:sync-context` and
   validate its marker/hash, secret scan and 12 KiB CI input budget. Preserve the
   local Kiro bridge; CI supplies the base digest explicitly.
7. Check links, English-only prose and relevant repository tests. Report skipped
   checks and unsupported runtime claims, rather than assigning a passing grade.
