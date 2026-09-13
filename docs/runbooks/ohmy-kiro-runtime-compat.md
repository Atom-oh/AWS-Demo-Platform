# oh-my-cloud-skills Kiro runtime compatibility

**Date: 2026-09-13. Status: producer preparation. Consumer integration below is planned until separately reviewed and activated.**

This phase stages the immutable launcher and its tests. The current runner
startup stays unchanged; the consumer follows verified producer readiness.

The trusted-base review for `Atom-oh/oh-my-cloud-skills` invokes Kiro with legacy
UI and noninteractive mode. CLI 2.21.4 can select engine v2 for that combination
and reject the call. The consumer's PR #228 adds explicit v1 arguments, but its
own review still executes the prior trusted-base script. The retained September 9
image containing Kiro 2.21.2 also reproduced the conflict; do not roll it out as
this recovery.

The planned consumer activation changes only the `oh-my-cloud-skills-claude-arm` runner fleet. It
keeps the shared `latest` image and original vendor binary. It does not change
reviewed branches, model selection, credentials, roles, resource requests,
preflight requirements, coverage, retries or budgets.

## Launcher contract

[`ohmy-kiro-cli.sh`](../../k8s/system/actions-runner/ohmy-kiro-cli.sh) is projected
as data at `/opt/ohmy-kiro-compat/kiro-cli`. Only a verified private copy becomes
executable and enters PATH. It adds `--agent-engine v1` only when:

- The first argument is `chat`, matching the consumer's trusted CI invocation.
- `--legacy-ui` or `--classic`, and `--no-interactive`, occur before the first `--`.
- No `--agent-engine`, `--agent-engine=...`, `--v1`, `--v2` or `--v3` occurs before that delimiter.

Those explicit engine spellings pass through even if invalid or conflicting;
the vendor reports its own error. Recognizing `--v1` does not promise that the
installed vendor supports that shorthand; PR #228 uses `--agent-engine v1`.
Only the exact legacy/headless tokens listed above activate the bridge, not
value-attached variants such as `--legacy-ui=true`. Arguments after `--` are
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
reviewed launcher's first 12 SHA-256 characters. The planned, separately reconciled
Helm ApplicationSet must reference that exact revision and hardcode its full digest.

Current prepared revision:

- ConfigMap: `demo-platform-ohmy-kiro-compat-f96ae62f9c7c`
- Launcher SHA-256: `f96ae62f9c7c5df74b8f17f176acfd8be76b15d4b9bbe36c9d7e9beded5c848c`

A launcher update needs a new producer revision before the consumer's name and
digest change. Retain every still-used old revision; follow the update sequence
below rather than replacing its immutable payload in place.

The planned [consumer ApplicationSet](../../argocd-apps/system/appset-helm-runner-claude-arm-oh-my-cloud-skills.yaml)
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
TMPDIR=/var/tmp bash tests/run-all.sh ohmy-kiro-compat
bash -n k8s/system/actions-runner/ohmy-kiro-cli.sh
kustomize build k8s/system/actions-runner
```

Producer prerequisites are Python 3 with PyYAML, Bash 4.4 or newer, and a writable
temporary directory that permits execution of fixture files. `TMPDIR=/var/tmp`
selects that directory when suitable. Missing Python/PyYAML or a `noexec` temporary
filesystem is a test failure to resolve, not a reason to skip required tests.
Standalone Kustomize performs the local rendering role of the repository's
`kubectl kustomize` convention without requiring cluster access.

The producer suite has eight launcher behavior tests and one packaging test.
It intercepts only the final vendor exec boundary and checks argv, streams,
exit/signal status, cwd and caller environment. The packaging test uses PyYAML
and SHA-256 to bind the current file to exactly one immutable generator with the
expected name, single-file data mapping and disabled automatic name suffix.
It does not read or test planned consumer startup. Compare the producer render
with base: existing identity/ExternalSecret objects must remain identical.

The separate consumer stage adds startup integrity tests. After that stage is
present, `TMPDIR=/var/tmp bash tests/run-all.sh ohmy-kiro` includes both suites.
Consumer tests additionally require GNU coreutils at the startup's absolute paths:
`/usr/bin/mktemp`, `/usr/bin/install`, `/usr/bin/sha256sum`, `/usr/bin/chmod` and
`/usr/bin/rm`. Their disposable projected-path and runner/vendor fixtures test
missing/mismatched bytes, checksum-tool PATH shadowing, private ownership/modes
and projection changes after registration. These checks do not ship in the
producer-only phase.

For the consumer stage, also render the pinned `gha-runner-scale-set` chart with
its actual `valuesObject`. Verify the required single-key data mount, full digest
and private-copy startup reach the AutoscalingRunnerSet. Existing Helm
roles/bindings, image, credentials, scheduling and resources must remain identical;
the chart-derived `actions.github.com/values-hash` annotation changes with values.
Neither suite invokes a provider or certifies live model behavior. Before rollout, independently
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

### Updating a deployed launcher revision

The producer Application prunes resources removed from its desired state. Before
adding a new launcher revision, inventory current consumer references and active
runners. Keep each still-used old ConfigMap in the Kustomization with its original
bytes, using a separate versioned source file when the current launcher changes.
Do not point an old immutable name at the new launcher file.

Add and verify the new producer revision first, then update the separately reviewed
consumer's exact ConfigMap name and full digest. Keep old revisions until every
consumer reference has moved and its old runners have drained. Only then remove
the old generator and source file through a later reviewed producer change. The
private copy protects running processes; it does not make early pruning safe for
pending or replacement Pods that still reference the old ConfigMap.

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

### Immutable-update failure in the shared producer Application

`actions-runner-secrets` also reconciles the shared ExternalSecret and ServiceAccount.
An immutable-data update rejection leaves that shared Application's sync incomplete;
do not assume its other pending manifest changes completed. Stop consumer rollout
and retain the failed sync evidence. Check the desired revision/name/digest against
the reviewed producer source and the existing ConfigMap, without printing secrets.

Recover through a reviewed Git correction: restore the original payload under any
still-used immutable name, retain it, and publish changed bytes under their new
digest name. Resume normal synchronization after that correction. Do not force
replace the shared Application, delete a still-used ConfigMap to retry the same
name, or delete/recreate the shared Secret or ServiceAccount. Verify the producer
sync, retained/new payload digests, ExternalSecret readiness and ServiceAccount
state before resuming consumer rollout.

If the bridge itself fails, retain failed checks and diagnose the exact argv,
mount and vendor version through the approved operator process. A reviewed
consumer rollback restores the original command; it does not waive the Kiro
conflict or allow incomplete coverage. Do not replace the vendor binary, fake a
version/reply, deploy the known-failing retained image, or weaken review gates.
