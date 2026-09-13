# ai-trader-web review runner compatibility

On **2026-09-12 (UTC)**, ai-trader-web's trusted review workflow required Claude
CLI `2.1.240`, while the shared moving runner image contained `2.1.266`.
[Review run 34698949748](https://github.com/Atom-oh/ai-trader-web/actions/runs/34698949748)
failed before reviewing a diff. This is a dated consumer-contract observation;
verify ai-trader-web's current workflow before changing the exception.

This repository's
[`appset-helm-runner-claude-arm-ai-trader-web.yaml`](../../argocd-apps/system/appset-helm-runner-claude-arm-ai-trader-web.yaml)
selects `actions-runner-claude:cli-2.1.240` with index digest
`sha256:cc315b2a639f1ad215a9907ee92128cadb586bf5390f32a84bcc82db81a7808a`,
`imagePullPolicy: IfNotPresent` and `DISABLE_AUTOUPDATER=1`. The digest selects
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
RUNNER_DIGEST=sha256:cc315b2a639f1ad215a9907ee92128cadb586bf5390f32a84bcc82db81a7808a
aws ecr describe-images --region ap-northeast-2 \
  --repository-name actions-runner-claude --image-ids imageDigest="$RUNNER_DIGEST" \
  --query 'imageDetails[0].{digest:imageDigest,tags:imageTags}'
aws ecr describe-images --region ap-northeast-2 \
  --repository-name actions-runner-claude --image-ids imageTag=cli-2.1.240 \
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

Do not restore moving `latest` while the consumer requires a fixed version.
Verify the replacement runner and full review before retiring the old reference.
This procedure changes CI infrastructure; it does not authorize trading runtime,
IAM, schedule or live-order changes.
