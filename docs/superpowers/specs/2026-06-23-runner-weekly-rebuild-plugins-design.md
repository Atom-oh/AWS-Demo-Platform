# Runner 주간 재빌드 + Claude Code 플러그인 베이킹 + Kiro v3

- **상태**: 설계 승인 (구현 중)
- **날짜**: 2026-06-23
- **대상**: `docker/actions-runner-claude/` 이미지, `.github/workflows/runner-image.yml`, `scripts/pr-review/run-panel.sh`
- **관련 ADR**: [ADR-007 Multi-AI PR Review Panel](../../decisions/ADR-007-multi-ai-pr-review-panel.md)

## 배경

`actions-runner-claude` 이미지는 PR 리뷰 패널(Codex + Kiro x3 + Claude 의장)을 구동하는 self-hosted GHA 러너 이미지다. 현재:

- `runner-image.yml` 은 `workflow_dispatch` 만 트리거 — 자동 빌드는 의도적으로 비활성(미검증 `curl|sh` 설치가 빌드를 red 시키는 것을 막기 위함).
- Dockerfile 은 베이스 이미지 위에 `codex` / `kiro-cli` 를 `curl|sh` 로 설치. `agy` 는 헤드리스 API-key 인증이 동작하지 않아 패널과 이미지에서 제거한다.
- 모든 12개 러너 스케일셋이 `actions-runner-claude:latest` 를 참조 → `:latest` 재푸시가 신규 ephemeral 러너 파드에 자동 전파.

## 목표

1. **주간 재빌드** — 베이스 이미지/CLI 최신 상태 유지.
2. **Claude Code 플러그인 베이킹** — 이미지에 플러그인을 설치·구성한 "ready" 상태로 출하.
3. **Kiro v3** — 패널 호출을 `kiro-cli --v3` 로 전환.

## 설계

### A0. 베이스 재작성 — self-referential FROM 수정 (핵심)

**문제**: Dockerfile 이 `FROM .../actions-runner-claude:latest` — 즉 **push 대상과 동일한 repo:tag** 를 베이스로 삼는다. 수동 1회 빌드일 땐 "published 베이스(claude-code 2.1.158, 521 MB)에 codex/kiro 만 얹기"로 괜찮았으나, **주간 cron 에선 매주 이전 `:latest` 위에 재귀 스택**된다:

- 단조 비대화 — 한 레이어가 ~400 MB(2.1.158=521 MB → latest=924 MB). 주당 그만큼 무한 증가.
- 베이스 미갱신 — `FROM` 이 외부 upstream 이 아닌 자기 출력이라 base OS/claude-code 가 영구 고정(로컬 claude 는 이미 2.1.186).
- 오염 누적 — 깨진 주간 빌드를 다음 주 `FROM` 이 물려받아 clean recovery 불가.

**수정**: `FROM` 을 **공식 ARC 러너 컨테이너 `ghcr.io/actions/actions-runner`**(Ubuntu 24.04 + .NET + runner agent), **ECR pull-through cache(prefix `ghcr`) 경유**로 전환. upstream 이미지라 self-reference 없음 + runner agent/OS/.NET 은 upstream 에 위임(직접 구성 안 함). 베이스에 sudo/git/curl/jq/unzip/docker-cli/runner(uid 1001)/run.sh 포함 → 여기선 gh/aws/node/**claude-code**/codex/kiro-cli/플러그인만 설치.

> AL2023 from-scratch 안도 검토했으나, runner agent 를 직접 구성(`installdependencies.sh` Ubuntu 기준)하는 리스크가 커서 공식 컨테이너 베이스로 결정. `actions/runner-images`(VM 이미지, 수십 GB)는 컨테이너가 아니라 베이스로 쓸 수 없다.

**인프라 추가**:
- `infra/ecr/pull-through-cache.tf` — ghcr PTC 규칙 + 자격증명 슬롯(`ecr-pullthroughcache/ghcr`, GitHub PAT read:packages, 값 수동 주입).
- `infra/iam/gha-ecr-push-role.tf` — `actions-runner-claude` push 권한(누락돼 있던 잠복 버그) + `ghcr/*` PTC import 권한 추가.

**검증 항목**: PTC 자격증명 동작, 빌드 역할 권한, `kiro-cli --v3` 플래그 — `workflow_dispatch` 1회 빌드 + 러너 등록으로 검증.

### A. 주간 재빌드 — `runner-image.yml`

`workflow_dispatch` 는 유지하고 `schedule` 추가:

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: "0 18 * * 6"   # 토 18:00 UTC = 일 03:00 KST
```

- **best-effort by construction**: `docker push` 는 `docker build` 성공 후에만 실행 → 설치 스크립트가 깨지면 빌드 단계에서 실패하고 push 에 도달하지 않음. ECR 의 live `:latest` 는 손대지 않으며 동작 중인 러너는 영향 없음.
- `schedule` 은 default branch(`main`)에서만 발화 → 이 변경은 main 에 머지되어야 활성화됨.

### B. Claude Code 플러그인 베이킹 — `Dockerfile`

`USER runner`(`HOME=/home/runner`)로 설치 → `~/.claude` 에 영속, 러너의 모든 `claude` 호출에서 사용 가능.

필수 플러그인 3종:

| 플러그인 | 마켓플레이스 | 소스 |
|---|---|---|
| `codex` | `openai-codex` | `openai/codex-plugin-cc` |
| `code-review` | `claude-plugins-official` | `anthropics/claude-plugins-official` |
| `github` | `claude-plugins-official` | `anthropics/claude-plugins-official` |

```dockerfile
RUN claude plugin marketplace add openai/codex-plugin-cc \
 && claude plugin marketplace add anthropics/claude-plugins-official \
 && claude plugin install codex@openai-codex \
 && claude plugin install code-review@claude-plugins-official \
 && claude plugin install github@claude-plugins-official \
 && claude plugin list
```

**codex 구성("codex:configure까지 진행")**: `/codex:setup` 슬래시 커맨드는 내부적으로 `codex-companion.mjs setup` 을 실행할 뿐이다. codex 바이너리는 이미지에 이미 설치되어 있고 Bedrock 네이티브(IAM, `codex login` 불필요)이므로, 빌드 시 companion setup 을 직접 실행하여 stop-time 리뷰 게이트를 **비활성**(헤드리스 패널과 무관한 인터랙티브 세션 기능)으로 설정 → 이미지가 first-run setup 없이 구성 완료 상태로 출하.

```dockerfile
RUN CODEX_PLUGIN="$(find /home/runner/.claude -type d -path '*plugins*/codex' | head -1)" \
 && node "$CODEX_PLUGIN/scripts/codex-companion.mjs" setup --json --disable-review-gate
```

> 정확한 플러그인 설치 경로/플래그명은 구현 시 빌드에서 검증해 조정한다.

### C. Kiro v3 — `run-panel.sh` + `Dockerfile`

- 패널 호출: `timeout "$T" kiro-cli --v3 chat "$PROMPT" --model "$m" ...`
- 빌드 검증 게이트: `kiro-cli --v3 --help` 추가 → v3 플래그 부재/리네임 시 주간 빌드가 조용히 깨지지 않고 즉시 실패.
- **리스크**: v3 가 기존 `--no-interactive` / `--trust-tools` / `--wrap` 플래그를 리네임할 수 있음 → 구현 시 설치된 바이너리로 확인 후 조정.

### D. Antigravity(`agy`) 제거

`agy` 는 헤드리스 API-key 인증이 동작하지 않고 인터랙티브 OAuth를 요구하므로 Dockerfile 설치, 러너 pod env, ExternalSecret에서 제거한다. 패널은 Codex + Kiro x3 + Claude 의장 구성을 유지한다.

### D2. 러너 자격증명 수정 (codex 무응답 근본 원인)

**증상**: codex 가 간헐적으로 무응답. **근본 원인**: 러너 파드는 공유 `claude-runner` SA 로 동작(`k8s/system/actions-runner/claude-runner-sa.yaml`)하지만, `infra/eks-mgmt/main.tf` 의 `local.runner_service_accounts` 목록에 `claude-runner` 가 없어 EKS Pod Identity Association 이 생성되지 않았다 → 파드가 `mall-apne2-mgmt-ci-runner` 역할을 받지 못하고, 노드 인스턴스 역할에는 Bedrock 권한이 전혀 없다. codex 의 `openai.gpt-5.5` 는 `bedrock-mantle:*`(오직 `ci_runner` 역할에만 존재)가 필수라 특히 실패한다.

**수정**: `local.runner_service_accounts` 에 `"claude-runner"` 추가 → Atlantis `apply -d infra/eks-mgmt`.

### D3. Kiro 호출 (kiro 미응답 점검)

증상은 `kiro`(bare)를 호출할 때 발생하나, 러너 경로(`scripts/pr-review/run-panel.sh`)는 일관되게 `kiro-cli` 를 사용함을 확인(레포 전역 bare `kiro` 호출 없음). v3 전환도 `kiro-cli --v3`(`kiro --v3` 아님)로 유지 → 추가 코드 수정 불필요.

### E. 문서

- ADR-007 갱신(패널이 GitHub/code-review 플러그인 + Kiro v3 획득, 러너 주간 재빌드).
- CLAUDE.md 러너 라인 갱신.

## 범위(Scope)

- **In**: 플러그인 베이킹 + codex 구성, 주간 cron, Kiro v3 패널 전환, 죽은 agy 제거, 문서.
- **Out**: 패널/의장 스크립트를 플러그인 기반으로 재작성하지 않음. 기존 헤드리스 호출(`codex exec`, `kiro-cli chat`, `claude -p` 의장)은 Kiro v3 전환을 제외하고 그대로 유지. 플러그인은 러너의 인터랙티브 `claude` 사용에 노출됨.

## 미해결/검증 항목

- **github 플러그인 헤드리스 인증**: 공식 `github` 플러그인의 MCP 는 보통 OAuth 로 인증 → 비대화형 빌드/러너에서 완료 불가. 실제 GitHub 호출이 필요하면 잡 env 의 PAT(`GITHUB_PERSONAL_ACCESS_TOKEN`) 배선이 필요. 본 작업에서는 설치·활성화만 하고 런타임 인증은 verify 단계 후속으로 남긴다.
- `claude plugin install` / `marketplace add` 의 빌드 시 네트워크 의존(GitHub) — best-effort 빌드 포스처와 동일하게 수용.

## 검증 계획

1. 로컬/CI 에서 이미지 빌드 → `claude plugin list` 가 3종 enabled 표시.
2. `kiro-cli --v3 --help` 통과.
3. `workflow_dispatch` 수동 1회 빌드 → ECR `:latest` 갱신 → 신규 PR 에서 패널 동작 확인.
4. 주간 cron 1회 통과 관찰.
