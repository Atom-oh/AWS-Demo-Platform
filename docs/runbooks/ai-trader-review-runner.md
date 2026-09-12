# ai-trader-web review runner compatibility

Observed on **2026-09-12 (UTC)**: the `ai-trader-web` review workflow verifies the installed Claude CLI before
reviewing any diff. Its current main contract pins `2.1.240`. The shared
`actions-runner-claude:latest` image moved to `2.1.266`, causing the
[PR 46 review run](https://github.com/Atom-oh/ai-trader-web/actions/runs/34698949748)
to fail before producing review coverage.

The project-specific ApplicationSet now selects `cli-2.1.240` plus the existing image index
`sha256:cc315b2a639f1ad215a9907ee92128cadb586bf5390f32a84bcc82db81a7808a`.
Its [build run](https://github.com/Atom-oh/AWS-Demo-Platform/actions/runs/32591238739)
records both `2.1.240 (Claude Code)` and that exported digest. ECR inspection
confirmed that the index remains available and contains a Linux/ARM64 manifest:
`sha256:84dd44a19e122e88e3a0f4a3b1d0d564344e972eb25f34d8c31e5287652ef9c3`.

`DISABLE_AUTOUPDATER=1` keeps the Claude CLI in this review fleet from updating itself
throughout the pod lifetime; see the vendor's
[auto-update setting](https://code.claude.com/docs/en/setup).
Other runner fleets still use their existing image references. The shared image
build and weekly refresh remain unchanged.

## Retention evidence and protection

On **2026-09-12**, the exact index was tagged `cli-2.1.240` in ECR and read back
through that tag. It resolved to the digest above. `latest` was checked before
and after and remained
`sha256:ce84881a72b0976ab1b27dcb0de85df23cdb574eaf787eccaf4c0d0c8674d14a`.
No tag was moved and no new image bytes were built.

The repository's **live** `get-lifecycle-policy` result on that date was
`LifecyclePolicyNotFoundException`. There was no active lifecycle policy for
`actions-runner-claude`; comments about `sha` retention in the build workflow do
not establish a live policy. The named tag also prevents this index becoming an
untagged candidate when moving `latest`/`sha-*` build tags change. The build job
does not write `cli-*` tags.

Treat `cli-2.1.240` as a retained compatibility tag: do not overwrite or remove it
while referenced. Before adding/changing the runner repository's lifecycle policy,
verify that no rule selects this protected tag/index. Being outside `main`, `v`
and `sha` prefixes protects it only from rules limited to those prefixes, not
from a future catch-all policy. Changing that policy requires an explicit retained
image review. Keep other repositories' Terraform policies separate.

Operator verification uses these read-only calls:

```bash
aws ecr describe-images --region ap-northeast-2 \
  --repository-name actions-runner-claude \
  --image-ids imageTag=cli-2.1.240 \
  --query 'imageDetails[0].{digest:imageDigest,tags:imageTags}'
aws ecr get-lifecycle-policy --region ap-northeast-2 \
  --repository-name actions-runner-claude
```

Only `LifecyclePolicyNotFoundException` establishes policy absence; do not treat
an access, network or authentication failure as absence. Reverify the digest/tag
and any policy immediately before consumer synchronization or recovery.

## Verification and maintenance

1. Merge only after the current-HEAD review and relevant checks pass.
2. Let `master-system-root` reconcile the ApplicationSet on `mall-apne2-mgmt`.
   Confirm the generated Application and `ai-trader-web-claude-arm` scale set
   select this tag/digest; keep the service account, resources and registration
   configuration unchanged. The generic `ai-trader-web-arm` fleet does not run
   this repository's Claude review job and is unchanged.
3. Rerun the failed ai-trader-web review against its unchanged PR HEAD, which
   requests an ephemeral runner because `minRunners` is zero. Require that runner
   pod to reach Running on the pinned ARM64 image and its actual version check
   to report `2.1.240 (Claude Code)`. Require
   the real CLI version check, all required lenses, and a trustworthy review
   verdict. A successful GitOps sync alone is not review evidence.
4. Platform CI and ai-trader-web maintainers re-evaluate this exception at the
   next shared-image maintenance review (**2026-09-19**) and whenever the
   consumer's CLI contract or security requirements change. Coordinate upgrades of this image reference and ai-trader-web's CLI
   contract. Verify the selected image's actual version and retain its ECR digest
   while referenced. Do not restore the moving `latest` reference while the
   consuming workflow still requires a fixed version.

## Recovery

If the image is unpullable, keep review checks blocked and inspect the event,
registry identity, retained tag/index and ARM64 child manifests. Restore the
same verified content from retained artifacts if available, or build and verify
a replacement containing the required CLI and publish it under a new unique
compatibility tag. Change the digest through review before selecting it.
Never move the existing compatibility tag or spoof a CLI version.

If the consumer upgrades its CLI contract, review that change and a compatible
retained image together, then update this fleet through a reviewed change.
Verify the new runner/version and full review coverage before retiring an old
reference. Restoring moving `latest` without a matching contract is not recovery.

This changes the dedicated review environment only. It does not change trading
runtime images, schedules, IAM grants, approval gates, or live-order behavior.
