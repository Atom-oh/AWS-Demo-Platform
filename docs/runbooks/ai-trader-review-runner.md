# ai-trader-web review runner compatibility

The `ai-trader-web` review workflow verifies the installed Claude CLI before
reviewing any diff. Its current main contract pins `2.1.240`. The shared
`actions-runner-claude:latest` image moved to `2.1.266`, causing the
[PR 46 review run](https://github.com/Atom-oh/ai-trader-web/actions/runs/34698949748)
to fail before producing review coverage.

The project-specific ApplicationSet now selects the existing image index
`sha256:cc315b2a639f1ad215a9907ee92128cadb586bf5390f32a84bcc82db81a7808a`.
Its [build run](https://github.com/Atom-oh/AWS-Demo-Platform/actions/runs/32591238739)
records both `2.1.240 (Claude Code)` and that exported digest. ECR inspection
confirmed that the index remains available and contains a Linux/ARM64 manifest:
`sha256:84dd44a19e122e88e3a0f4a3b1d0d564344e972eb25f34d8c31e5287652ef9c3`.

`DISABLE_AUTOUPDATER=1` keeps the CLI in this review fleet from updating itself
after the initial version check; see the vendor's
[auto-update setting](https://code.claude.com/docs/en/setup).
Other runner fleets still use their existing image references. The shared image
build and weekly refresh remain unchanged.

## Verification and maintenance

1. Merge only after the current-HEAD review and relevant checks pass.
2. Let `master-system-root` reconcile the ApplicationSet on `mall-apne2-mgmt`.
   Confirm the generated Application and `ai-trader-web-claude-arm` scale set
   select this digest; keep the service account, resources and registration
   configuration unchanged.
3. Rerun the failed ai-trader-web review against its unchanged PR HEAD. Require
   the real CLI version check, all required lenses, and a trustworthy review
   verdict. A successful GitOps sync alone is not review evidence.
4. Coordinate future upgrades of this image reference and ai-trader-web's CLI
   contract. Verify the selected image's actual version and retain its ECR digest
   while referenced. Do not restore the moving `latest` reference while the
   consuming workflow still requires a fixed version.

This changes the dedicated review environment only. It does not change trading
runtime images, schedules, IAM grants, approval gates, or live-order behavior.
