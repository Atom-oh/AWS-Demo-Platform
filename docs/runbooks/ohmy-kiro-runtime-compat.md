# oh-my-cloud-skills Kiro runtime compatibility

**Date: 2026-09-13. Status: temporary bootstrap candidate; rollout requires normal platform review and runtime verification.**

The trusted-base review for `Atom-oh/oh-my-cloud-skills` invokes Kiro with legacy
UI and noninteractive mode. CLI 2.21.4 can select engine v2 for that combination
and reject the call. The consumer's PR #228 adds explicit v1 arguments, but its
own review still executes the prior trusted-base script. The retained September 9
image containing Kiro 2.21.2 also reproduced the conflict; do not roll it out as
this recovery.

This bridge changes only the `oh-my-cloud-skills-claude-arm` runner fleet. It
keeps the shared `latest` image and original vendor binary. It does not change
reviewed branches, model selection, credentials, roles, resource requests,
preflight requirements, coverage, retries or budgets.

## Launcher contract

[`ohmy-kiro-cli.sh`](../../k8s/system/actions-runner/ohmy-kiro-cli.sh) is projected
as data at `/opt/ohmy-kiro-compat/kiro-cli`. Only a verified private copy becomes
executable and enters PATH. It adds `--agent-engine v1` only when:

- The first argument is `chat`, matching the consumer's trusted CI invocation.
- `--legacy-ui` or `--classic`, and `--no-interactive`, occur before the first `--`.
- No `--agent-engine`, `--agent-engine=...`, `--v2` or `--v3` occurs before that delimiter.

An explicit engine selection is preserved even if it is invalid or conflicts
with other options; the vendor reports its own error. Arguments after `--` are
opaque. Added options precede that delimiter. Other commands, including version,
help and agent validation, pass through.

The launcher directly executes `/home/runner/.local/bin/kiro-cli`, preserving
argument boundaries, stdin, cwd, environment, stdout, stderr and exit/signal
status. It emits no notice or prompt/argument logs and never rewrites a reply.
There is no production override for the vendor executable path.

## Packaging and ownership

The existing `actions-runner-secrets` ArgoCD Application reconciles
[`k8s/system/actions-runner`](../../k8s/system/actions-runner/kustomization.yaml).
Its Kustomize generator produces an immutable ConfigMap in
`actions-runner-system`. The `demo-platform-ohmy-kiro-compat-` name ends with the
reviewed launcher's SHA-256 prefix. The separately reconciled Helm ApplicationSet
references that exact revision. A launcher change needs a new name and matching
hardcoded startup digest in the same reviewed change.

Only the [consumer ApplicationSet](../../argocd-apps/system/appset-helm-runner-claude-arm-oh-my-cloud-skills.yaml)
projects only its `kiro-cli` key at `/opt/ohmy-kiro-compat`, read-only and
non-executable (`0444`). The ConfigMap is required.

Before registering a runner, startup creates a fresh private directory with
`/usr/bin/mktemp -d`, owned by the runner user. It copies the projected file with
mode `0400`, then checks the copied bytes against the hardcoded reviewed SHA-256
using absolute `/usr/bin/sha256sum`. Failure exits without executing the runner
or the projected content. Only after a successful check does startup set the
copy to `0500`, prepend its private directory to the inherited PATH, and exec
the existing `/home/runner/run.sh`.

The projection never enters PATH. Changes or replacement of the ConfigMap cannot
alter the copied executable used by an already registered runner. Failed startup
cleans up its private directory; successful exec retains the copy for the
ephemeral container's lifetime. This needs no new privilege, init container,
fsGroup or resource increase. The vendor file, other fleets, image build and
shared identity/secret manifests remain unchanged.

## Local validation

```bash
TMPDIR=/var/tmp bash tests/run-all.sh ohmy-kiro
bash -n k8s/system/actions-runner/ohmy-kiro-cli.sh
kustomize build k8s/system/actions-runner
```

The tests require Python 3 and PyYAML, already used by the platform's Kubernetes
checks. Use standalone Kustomize for local rendering. Also render the pinned
`gha-runner-scale-set` chart with the ApplicationSet's actual `valuesObject`.
Check that the required immutable/versioned ConfigMap, single-key read-only data
mount, hardcoded digest and private-copy startup reach the AutoscalingRunnerSet.
Compare base and candidate renders:
existing producer objects, Helm roles/bindings, runner image, credentials,
scheduling and resources must remain identical. The chart's derived
`actions.github.com/values-hash` annotation changes with the new values.

Producer tests cover launcher argv/process behavior; consumer tests add startup
integrity checks. The local tests intercept the final vendor/runner exec boundaries and map the
projected source path into a disposable fixture. They check mismatched/missing
bytes, checksum-tool PATH shadowing, private ownership/modes and projection
changes after registration alongside argv/stream/exit behavior. They do not
invoke a provider or certify live model behavior. Before rollout, independently
verify the packaged launcher with both configured models: exact `NO_TOOLS`
preflights first, then small synthetic reviews, with no fallback, diagnostic,
tool use or canary disclosure. Record outcomes without credential or prompt dumps.

## Reviewed rollout order

Follow [review and release](review-and-release.md). Latest-HEAD platform review,
relevant checks and actual branch requirements must pass before either stage.
Missing model coverage or failed review is not approval.

1. **Producer first:** publish the launcher, ConfigMap generator and tests through
   normal review. Verify the producer has reconciled the expected ConfigMap key
   and reviewed payload digest in the intended management cluster/namespace.
2. **Consumer second:** only after producer readiness, merge the separately
   reviewed ApplicationSet change. The two ArgoCD Applications have no implicit
   synchronization order. A missing required ConfigMap must prevent a new runner
   from starting rather than permit a silent fallback.
3. Observe a fresh ephemeral runner on this fleet, verify that PATH resolves to
   the verified private copy and the vendor binary is unchanged, and rerun the intended consumer PR at its unchanged
   HEAD. Require genuine complete configured reviews and the normal verdict.
   Preserve active jobs and all failed review evidence.

Skip this bootstrap rollout if PR #228 has already landed and fresh trusted-base
reviews complete without it. Local rendering, a healthy ArgoCD Application and
successful probes are separate from a complete substantive PR review.

## Removal and recovery

Once PR #228 is merged, verify that the actual trusted base passes explicit v1
on both preflight and review calls. The bridge then passes those calls through.
After a fresh complete consumer review, remove the consumer's PATH prepend,
compatibility mount and volume through normal platform review, restoring
`command: ["/home/runner/run.sh"]`.

Require a new unwrapped runner and a complete normal review before removing the
ConfigMap generator and launcher. Confirm that no remaining runner still uses
the mount before retiring the producer. Do not delete the existing shared secret
or service-account resources.

If the bridge itself fails, retain failed checks and diagnose the exact argv,
mount and vendor version through the approved operator process. A reviewed
consumer rollback restores the original command; it does not waive the Kiro
conflict or allow incomplete coverage. Do not replace the vendor binary, fake a
version/reply, deploy the known-failing retained image, or weaken review gates.
