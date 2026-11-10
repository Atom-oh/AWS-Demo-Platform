# ai-trader-web review runner compatibility

On **2026-09-12 (UTC)**, ai-trader-web's trusted review workflow required Claude
CLI `2.1.240`, while the shared moving runner image contained `2.1.266`.
[Review run 34698949748](https://github.com/Atom-oh/ai-trader-web/actions/runs/34698949748)
failed before reviewing a diff. This is a dated consumer-contract observation;
verify ai-trader-web's current workflow before changing the exception.

This repository's
[`appset-helm-runner-claude-arm-ai-trader-web.yaml`](../../argocd-apps/system/appset-helm-runner-claude-arm-ai-trader-web.yaml)
selects `actions-runner-claude:cli-2.1.240-20261110t062144z` with index digest
`sha256:f23d3702a5fcfe385461abc753d612566182e58ce3e7aadbce19d1da9c9eb765`
(see "Replacement selection" below), `imagePullPolicy: IfNotPresent` and
`DISABLE_AUTOUPDATER=1`. The previous `cli-2.1.240` index
`sha256:cc315b2a639f1ad215a9907ee92128cadb586bf5390f32a84bcc82db81a7808a` stays
retained until the replacement's real review passes. The digest selects
content; the tag supports retention/audit. Tag read-back alone does not verify
that the image is pullable or contains the required CLI. Check the actual runner.
The updater setting applies to Claude; the digest freezes the whole image/toolchain.

## Dated evidence and retention

[Build run 32591238739](https://github.com/Atom-oh/AWS-Demo-Platform/actions/runs/32591238739)
recorded `2.1.240 (Claude Code)` and the index above. September 12 ECR inspection
reported Linux/ARM64 child manifest
`sha256:84dd44a19e122e88e3a0f4a3b1d0d564344e972eb25f34d8c31e5287652ef9c3`.
The [post-merge operator record](https://github.com/Atom-oh/AWS-Demo-Platform/pull/105#issuecomment-5646737900)
reported:

- The complete tag set on that index was `[cli-2.1.240]`, with no `sha-*` tag.
- `get-lifecycle-policy` returned `LifecyclePolicyNotFoundException`.
- The generated runner template selected the pin, a new Pod reached Running/Ready,
  and the actual CLI preflight passed. Substantive review was still running;
  this record does not establish its final verdict or current fleet health.

`infra/ecr/main.tf` excludes this existing runner repository from Terraform
ownership. Retention is an operator constraint, not an implemented lifecycle
exemption. Do not overwrite/remove the compatibility tag or delete the index while
referenced. Before future tag/policy changes or Terraform adoption, evaluate the
**entire tag set on the digest**, every matching rule and catch-all rules. A future
build tag can change eligibility; that is not a claim that one was present in the
September 12 record. The shared build writes `latest` and `sha-*`, not `cli-*`.

Recheck the digest independently of the tag and inspect policy immediately before
consumer synchronization or recovery:

```bash
RUNNER_DIGEST=sha256:f23d3702a5fcfe385461abc753d612566182e58ce3e7aadbce19d1da9c9eb765
RUNNER_TAG=cli-2.1.240-20261110t062144z
aws ecr describe-images --region ap-northeast-2 \
  --repository-name actions-runner-claude --image-ids imageDigest="$RUNNER_DIGEST" \
  --query 'imageDetails[0].{digest:imageDigest,tags:imageTags}'
aws ecr describe-images --region ap-northeast-2 \
  --repository-name actions-runner-claude --image-ids imageTag="$RUNNER_TAG" \
  --query 'imageDetails[0].{digest:imageDigest,tags:imageTags}'
aws ecr batch-get-image --region ap-northeast-2 \
  --repository-name actions-runner-claude --image-ids imageDigest="$RUNNER_DIGEST" \
  --query '{images:images[].{id:imageId,manifest:imageManifest},failures:failures}'
aws ecr get-lifecycle-policy --region ap-northeast-2 \
  --repository-name actions-runner-claude
```

Inspect failures and referenced ARM64 manifests; a zero exit status or existing
tag alone is insufficient. Only `LifecyclePolicyNotFoundException` means no
policy; access/network/authentication failures do not establish absence.

## Verification and removal/upgrade triggers

1. Require current-HEAD review and relevant checks for a fleet change. Let
   `master-system-root` reconcile on the verified `mall-apne2-mgmt` context.
2. Confirm the generated Application and `ai-trader-web-claude-arm` scale set
   select the intended digest/configuration. The generic `ai-trader-web-arm`
   fleet is separate from ai-trader-web's Claude review job. This repository's
   own review uses `aws-demo-platform-claude-arm`.
3. Rerun the consumer review against the intended unchanged PR HEAD. With
   `minRunners: 0`, require a new ephemeral runner to reach Running on the selected
   ARM64 image, report the required CLI version and pass the real version check.
   Require every required lens and a trustworthy final verdict; GitOps health
   and CLI preflight success are not completed review coverage.
4. Platform CI and ai-trader-web maintainers re-evaluate at the next scheduled
   image maintenance review (**2026-09-19**), consumer contract changes, or available
   security fixes for the CLI, other bundled tools or base image. Security-fix
   availability is a trigger to replace/remove the exception, not to wait for the
   weekly date. Coordinate a compatible retained image and consumer version check;
   preserve the old digest until the replacement's real review passes.

## Recovery

If image pull fails, keep review checks blocked and inspect registry identity,
Pod events, the retained index and ARM64 child. Restore the same verified content
from retained artifacts if available. Otherwise build/verify a compatible replacement
under a new unique compatibility tag and review its digest before selection.
Never move the old tag, spoof the CLI version or weaken review gates.

Build a replacement with the manual
[`runner-image-compat.yml`](../../.github/workflows/runner-image-compat.yml)
workflow on `main` (input: the exact Claude CLI version). It uses the current
upstream runner base and current gh/AWS CLI/Node/Codex/Kiro, installs exactly that
Claude version (the build fails otherwise) and pushes only a new
`cli-<version>-<UTC timestamp>` tag, never `latest`, `sha-*` or an existing tag.
The run summary records the tag, the pushed image digest, Claude version and
actions-runner version. Depending on the runner's Docker image store, that digest
is an OCI index (like the current pin) or a single-platform manifest; either
pins content. Inspect which one it is, and its ARM64 child for an index, before
selecting it in the appset, which is a separate reviewed change.

### Dated observation: frozen runner binary (2026-11-09 UTC)

The frozen index also freezes the GitHub Actions runner binary, and the ARC
runner does not self-update. On 2026-11-09 ai-trader-web review run
[42537157003](https://github.com/Atom-oh/ai-trader-web/actions/runs/42537157003)
stayed queued: two successive `ai-trader-web-claude-arm` EphemeralRunners reached
`Failed` / `TooManyPodFailures` (six Pod starts each, each exiting within about a
minute), while `:latest` fleets on the same cluster ran jobs. Local inspection of
the pinned index found actions runner `2.336.0`; the latest upstream release was
`v2.338.2` (2026-10-26). The failed Pods were already gone, so their exit logs were
not captured; the stale runner is the supported cause, not a recorded log line. A
local build of this Dockerfile with `CLAUDE_VERSION=2.1.240` produced runner
`2.338.2` and `2.1.240 (Claude Code)`.

A version-pinned fleet therefore needs a periodic replacement build even when the
consumer's CLI contract has not changed.

### Replacement selection (2026-11-10 UTC)

[Build run 42767943850](https://github.com/Atom-oh/AWS-Demo-Platform/actions/runs/42767943850)
on `main` (`33b116d`) pushed `cli-2.1.240-20261110t062144z`. ECR
`describe-images` and `batch-get-image` on 2026-11-10 reported:

- OCI index `sha256:f23d3702a5fcfe385461abc753d612566182e58ce3e7aadbce19d1da9c9eb765`,
  whose only tag is `cli-2.1.240-20261110t062144z`.
- Linux/ARM64 child manifest
  `sha256:ec4dc322ef75ebbd86a3805ab95e9672476ad324f590b6e813fed7183a640a33`, plus
  one attestation manifest.
- `get-lifecycle-policy`: `LifecyclePolicyNotFoundException`.

Pulling that digest on a workstation and running it reported
`2.1.240 (Claude Code)`, actions runner `2.338.2`, `arm64 linux`.

The concurrent [run 42767928450](https://github.com/Atom-oh/AWS-Demo-Platform/actions/runs/42767928450)
pushed `cli-2.1.240-20261110t062136z`
(`sha256:bff51bfc15b861128fa4b44fd6990b702524fe09c502e76673253caf1972d099`).
Nothing selects it. It is a removal candidate for an operator; this change does not
delete it. The previous `cli-2.1.240` index keeps its tag and stays retained. Retire
it only after the replacement's real ai-trader-web review completes (Verification
step 3).

Do not restore moving `latest` while the consumer requires a fixed version.
Verify the replacement runner and full review before retiring the old reference.
This procedure changes CI infrastructure; it does not authorize trading runtime,
IAM, schedule or live-order changes.
