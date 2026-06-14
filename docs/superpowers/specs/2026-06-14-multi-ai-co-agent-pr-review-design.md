# Multi-AI co-agent PR 리뷰 패널 설계

- **날짜**: 2026-06-14
- **상태**: 설계 승인 (구현 대기)
- **영향 범위**: 러너 이미지(이 repo로 이관) · `infra/{ecr,secrets-manager,iam}` · `argocd-apps/system` · `k8s/system` · `.github/workflows/pr-review.yml` · `scripts/pr-review/`

## 1. 배경 / 목적

현재 `.github/workflows/pr-review.yml`은 self-hosted 러너 `aws-demo-platform-claude-arm`(ARM64 ARC pod, ECR 이미지 `actions-runner-claude:latest`)에서 pre-install된 `claude` CLI를 Bedrock(ap-northeast-2, `global.anthropic.claude-opus-4-8`)로 호출해 PR diff를 단일 리뷰하고, 마지막 줄 `VERDICT: PASS|FAIL`로 게이트를 결정한다.

이 단일 리뷰를 **멀티 AI co-agent 패널**로 확장한다. Codex와 Kiro(3개 모델)를 추가 패널로 두고, **Claude Opus 4.8이 의장(chair)으로 패널 결과를 종합**해 하나의 리뷰 + VERDICT를 생성한다. co-agent 플러그인의 `ai-cli-adapters` fan-out 패턴을 CI에 이식한다.

부수적으로, 그동안 외부 repo(`multi-region-architecture`)에서 빌드되던 러너 이미지를 **이 repo로 이관**한다(관리 영역 통합 방침).

## 2. 결정 사항 (확정)

| 항목 | 결정 |
|---|---|
| 바이너리 위치 | 러너 이미지에 baking (런타임 설치 아님) |
| 리뷰 모델 | **Claude Opus 4.8 의장 종합** — 패널은 findings만, 의장이 단일 VERDICT |
| 패널 구성 | **Codex + Kiro×3** (Gemini 제외) |
| Codex 인증 | **Bedrock 네이티브** — `~/.codex/config.toml`(`model_provider = "amazon-bedrock"`), 시크릿 불필요. 러너 노드 IAM 사용 |
| Codex 모델 | `openai.gpt-5.5`, region `us-east-2`, `model_reasoning_effort = "xhigh"` |
| Kiro 인증 | `KIRO_API_KEY` — Secrets Manager → ExternalSecret → 러너 env |
| Kiro 모델 | `claude-opus-4.8`, `kimi-k2.5`, `glm-5` (계정 등급에 따라 `kimi-k2.5`는 graceful skip 가능) |
| 러너 이미지 소유 | **이 repo** (`docker/actions-runner-claude/` + 빌드 워크플로 + ECR TF) |
| 오케스트레이션 | **repo 스크립트** (`scripts/pr-review/`), 인라인 YAML 아님 |
| 게이트 의미 | 현행 유지 — fail-closed (VERDICT 없으면 FAIL) |

## 3. 패널 구성

| 패널 | 호출 | 모델 | 인증 | 컨텍스트 파일 |
|---|---|---|---|---|
| **Codex** | `codex exec -s read-only "<PROMPT>"` | `openai.gpt-5.5` (Bedrock us-east-2) | 러너 노드 IAM | `AGENTS.md` (자동 로드) |
| **Kiro (opus)** | `kiro-cli chat "<PROMPT>" --model opus --no-interactive --trust-tools=read,grep --wrap never` | `opus` | `KIRO_API_KEY` | `CLAUDE.md` |
| **Kiro (kimi)** | `… --model kimi-k2.5 …` | `kimi-k2.5` | `KIRO_API_KEY` | `CLAUDE.md` |
| **Kiro (glm)** | `… --model glm-5 …` | `glm-5` | `KIRO_API_KEY` | `CLAUDE.md` |
| **의장: Claude** | `claude -p "<SYNTH_PROMPT>" --output-format text` | `global.anthropic.claude-opus-4-8` (Bedrock ap-northeast-2) | 러너 노드 IAM | `CLAUDE.md` |

- 패널 프롬프트는 "diff를 리뷰해 버그/보안/컨벤션 위반 findings를 출력하라. **VERDICT 라인은 출력하지 말 것.**" 형태로, 각 패널은 자신의 컨텍스트 파일(Codex=AGENTS.md, Kiro=CLAUDE.md)을 자동 참조한다.
- 의장 프롬프트는 현행 pr-review.yml의 프로젝트 체크리스트 + "패널 출력들을 종합하라" + VERDICT 규칙을 포함한다. 패널 출력은 stdin/컨텍스트로 주입한다.
- **graceful degradation**: 패널 호출이 타임아웃/실패/바이너리 부재 시 `[skip]`로 처리하고 종합은 응답한 패널만으로 진행. 패널 전원 skip이면 Claude 단독 리뷰(현재 동작)로 강등.

## 4. 변경 영역

### 4.1 러너 이미지 (이 repo로 이관)

**`docker/actions-runner-claude/Dockerfile`**
- 베이스: 현행 `actions-runner-claude:latest` 패리티 유지(claude-code CLI, `gh`, AWS CLI, Node, git). 구현 시 현행 이미지에서 `claude --version`, `gh --version`, `aws --version`, `node --version`을 추출해 패리티 검증 항목으로 기록.
- 추가 설치(ARM64):
  - `codex` CLI
  - `kiro-cli` CLI (바이너리명 `kiro-cli`, `kiro` 아님)
- `/home/runner/.codex/config.toml` baking:
  ```toml
  model = "openai.gpt-5.5"
  model_provider = "amazon-bedrock"
  model_reasoning_effort = "xhigh"
  [model_providers.amazon-bedrock.aws]
  region = "us-east-2"
  ```
  - **비대화형 강화**: `codex exec`는 헤드리스라 TUI trust 다이얼로그가 뜨지 않지만, first-run 승인 가능성까지 제거하기 위해 config.toml에 `approval_policy = "never"`(+ 필요 시 프로젝트 trust 항목)를 추가한다. 정확한 키는 `codex` 빌드 버전에서 확인(§9).
- **검증**: 이미지 빌드 후 `codex --version`, `kiro-cli --version`, `kiro-cli --list-models`(모델 가용성)로 스모크 테스트.

**`.github/workflows/runner-image.yml`** (신규)
- `runs-on: aws-demo-platform-arm`에서 네이티브 ARM64 빌드(에뮬레이션 없음).
- OIDC `role-to-assume: arn:aws:iam::180294183052:role/demo-platform-gha-ecr-push` → `amazon-ecr-login` → `docker build --platform=linux/arm64` → push.
- 태그 전략: `:latest` + `:<git-sha>` (backend-ci.yml 패턴 재사용). 트리거는 `docker/actions-runner-claude/**` 변경 시 + `workflow_dispatch`.

**`infra/ecr/`**
- `actions-runner-claude` 레포를 `main.tf`의 `for_each` 목록에 추가(현재 수동 생성된 레포를 TF로 흡수; `terraform import` 필요할 수 있음 — 구현 시 plan 확인).

### 4.2 시크릿 / 와이어링

**`infra/secrets-manager/`**
- 슬롯 `/demo-platform/kiro/api-key` 신설(naming convention `/demo-platform/*` 준수). 값은 수동 주입(`aws secretsmanager put-secret-value`) — TF는 슬롯/리소스만 정의, 시크릿 값은 관리하지 않음.

**ExternalSecret** (`k8s/system/` 하위 신규 디렉터리 + `argocd-apps/system/` 매칭 Application, 또는 기존 actions-runner 매니페스트 경로에 편입)
- 네임스페이스 `actions-runner-system`.
- `ClusterSecretStore: aws-secrets-manager`(기존), `external-secrets.io/v1` API.
- target K8s Secret `kiro-api-key`, key `KIRO_API_KEY` ← `/demo-platform/kiro/api-key`.

**`argocd-apps/system/appset-helm-runner-claude-arm-aws-demo-platform.yaml`**
- `template.spec.containers[0]`(name: runner)에 추가:
  ```yaml
  env:
    - name: KIRO_API_KEY
      valueFrom:
        secretKeyRef:
          name: kiro-api-key
          key: KIRO_API_KEY
  ```

**IAM (러너 노드 역할)**
- `us-east-2` Bedrock에서 `openai.gpt-5.5` 추론 프로파일 호출 권한 추가:
  - `bedrock:InvokeModel` (+ 필요 시 `bedrock:InvokeModelWithResponseStream`)
  - 리소스: `arn:aws:bedrock:us-east-2::foundation-model/openai.gpt-5.5*` + `arn:aws:bedrock:us-east-2:180294183052:inference-profile/*openai.gpt-5.5*`
- 현행 ap-northeast-2 Claude 권한은 유지.
- **노드 역할 정의 위치 확인 필요**: Karpenter EC2NodeClass의 노드 IAM 역할(이 repo `k8s/system/karpenter/` 또는 `infra/eks-mgmt/`, 혹은 mra). 구현 첫 단계에서 위치 확정 후 해당 곳에 정책 추가.

### 4.3 워크플로 + 스크립트

**`scripts/pr-review/run-panel.sh`** (신규)
- 입력: diff 파일 경로, 패널 프롬프트 파일 경로, 출력 디렉터리.
- co-agent `ai-cli-adapters` 패턴: 각 패널을 백그라운드 서브프로세스 + `timeout`으로 병렬 실행, 슬롯 파일(`codex.md`, `kiro-opus.md`, `kiro-kimi.md`, `kiro-glm.md`)에 기록. 실패/타임아웃/바이너리 부재 시 `[skip] <panel>` 로깅 후 빈 슬롯.
- 바이너리 존재 검사: `command -v codex`, `command -v kiro-cli`.
- **no-hang 보장**: 각 패널 호출은 ① 비대화형 플래그(Kiro `--no-interactive --trust-tools=read,grep`, Codex `exec -s read-only`) ② `timeout` 백스톱 ③ stdin을 `/dev/null` 또는 diff 파이프로만 연결(TTY 입력 대기 차단)로 감싼다. trust/승인 프롬프트가 발생할 상황이면 hang이 아니라 timeout→`[skip]`으로 떨어진다.
- 출력: 응답한 패널 목록(`responded.txt`)을 종합 단계에 전달.

**`scripts/pr-review/synthesize.sh`** (신규 또는 워크플로 인라인)
- 입력: diff(truncated), 패널 슬롯 파일들, responded 목록.
- 의장 프롬프트(현행 프로젝트 체크리스트 + "아래 패널 리뷰들을 종합. 합의/이견을 정리. 최종 VERDICT 1줄") 구성 → `claude -p ... --output-format text > review.md`.
- 패널 출력은 프롬프트 본문 또는 stdin으로 주입.

**`.github/workflows/pr-review.yml`** (수정)
- "Verify Claude Code CLI present" 스텝에 `codex` / `kiro-cli` 존재 확인 추가(부재 시 `::warning::`, 게이트는 비차단 — 이미지에 baking 되어 있어야 정상).
- "Review with Claude Code" 단일 스텝을 다음으로 교체:
  1. diff + 패널 프롬프트 준비 (현행 diff 필터 로직 유지)
  2. `run-panel.sh` 호출 (fan-out)
  3. `synthesize.sh` 호출 (종합 + VERDICT)
  4. 게이트 판정(현행 로직 유지)
  5. 코멘트 upsert — `## 🤖 AI Code Review` 헤더 아래 **Panel** 줄 추가(예: `_Panel: Claude(chair) · Codex · Kiro(opus,glm) · ~~Kiro(kimi: skipped)~~_`).
- env에 Codex용 `AWS_REGION`/추가 변수는 불필요(config.toml이 us-east-2 지정). 단, Codex가 SDK 기본 자격증명 체인을 us-east-2로 쓰도록 config.toml `region`이 우선함을 확인.

## 5. 데이터 흐름

```
pull_request_target
  └─ pr-review.yml (runs-on: aws-demo-platform-claude-arm)
       1. checkout + diff 필터 → /tmp/pr-diff-truncated.txt
       2. run-panel.sh (병렬, timeout)
            ├─ codex exec -s read-only          → slot/codex.md      (Bedrock us-east-2, gpt-5.5)
            ├─ kiro-cli chat --model opus        → slot/kiro-opus.md  (KIRO_API_KEY)
            ├─ kiro-cli chat --model kimi-k2.5   → slot/kiro-kimi.md  (skip 가능)
            └─ kiro-cli chat --model glm-5       → slot/kiro-glm.md
       3. synthesize.sh
            └─ claude -p (Opus 4.8, Bedrock ap-northeast-2)
                 입력: diff + 모든 slot/*.md
                 출력: review.md (+ 마지막 줄 VERDICT)
       4. 게이트: grep '^VERDICT: (PASS|FAIL)$' (fail-closed)
       5. 코멘트 upsert (marker, Panel 줄 포함)
```

## 6. 에러 처리 / 불변식

- **fail-closed 게이트**: `VERDICT:` 라인이 없으면 FAIL(현행 유지).
- **패널 graceful skip**: 개별 패널 실패가 전체 잡을 실패시키지 않음. 의장 종합은 응답분으로 진행.
- **no-hang 불변식**: 어떤 패널도 trust/승인/입력 프롬프트로 멈추지 않음 — 비대화형 플래그 + `timeout` + stdin 격리로 보장(§4.3).
- **패널 전원 실패**: Claude 단독 리뷰로 강등 → 현행 동작과 동일하게 항상 리뷰는 생성됨.
- **코멘트 upsert 불변식**: `<!-- aws-demo-platform-pr-review -->` marker, PATCH 우선.
- **concurrency**: `pr-review-${{ PR번호 }}`, `cancel-in-progress: true` 유지.
- **비프로덕션 허용치**: PR당 최대 5회 모델 호출(Codex 1 + Kiro 3 + Claude 1)로 지연 증가하나 허용([[non-production-tolerance]]).

## 7. 테스트 / 검증

- `run-panel.sh` 단위: 바이너리 모킹으로 (a) 전원 응답 (b) 일부 skip (c) 전원 skip 케이스에서 슬롯/responded 출력 검증.
- 이미지 스모크: 빌드 후 `codex --version`, `kiro-cli --version`, `kiro-cli --list-models`, `claude --version`.
- Codex Bedrock 라이브 검증: 러너에서 `echo "diff" | codex exec -s read-only "한 줄 요약"` 성공 확인(us-east-2 IAM 권한 확인 포함).
- Kiro 인증 검증: 러너에서 `KIRO_API_KEY` 주입 후 `kiro-cli chat "ping" --model opus --no-interactive` 성공.
- E2E: 테스트 PR로 패널 4개 응답 → 종합 코멘트 1개 + 정상 VERDICT 확인.
- `bash tests/run-all.sh` 회귀 통과.

## 8. 구현 단계(요약, 상세 플랜은 writing-plans에서)

1. **러너 이미지** — Dockerfile + config.toml + 빌드 워크플로 + ECR TF, push & 스모크.
2. **IAM** — 노드 역할 us-east-2 Bedrock 권한(위치 확정 후), Codex 라이브 검증.
3. **Kiro 시크릿** — Secrets Manager 슬롯 + 값 주입 + ExternalSecret + appset env, Kiro 라이브 검증.
4. **오케스트레이션** — `run-panel.sh` + `synthesize.sh` + pr-review.yml 교체, 단위 테스트.
5. **E2E + 문서** — 테스트 PR 검증, ADR 작성(멀티 AI 리뷰 결정), 관련 CLAUDE.md/architecture.md 동기화.

## 9. 미해결 / 확인 필요 (구현 첫 단계에서 처리)

- 현행 `actions-runner-claude` 이미지의 정확한 베이스/설치 목록(패리티 확보).
- `codex` / `kiro-cli` ARM64 설치 방법(npm/curl/바이너리 릴리스).
- 러너 노드 IAM 역할의 실제 정의 위치(이 repo vs mra).
- `infra/ecr`에서 기존 `actions-runner-claude` 레포의 TF import 여부.
- `kiro-cli`의 모델 ID 정확성(`glm-5` vs `glm-4.6` 등) — `kiro-cli --list-models`로 확정.
- `codex exec`의 비대화형 승인 키 정확성(`approval_policy = "never"` 등) 및 프로젝트 trust 필요 여부 — 라이브 검증 시 프롬프트 hang 없는지 확인.

## 10. 관련 문서

- 기존 워크플로: `.github/workflows/pr-review.yml`
- 러너 appset: `argocd-apps/system/appset-helm-runner-claude-arm-aws-demo-platform.yaml`
- 빌드 패턴 선례: `.github/workflows/backend-ci.yml`, ADR-003 (GHA OIDC → ECR push), ADR-006 (ARM64 Graviton 네이티브 빌드)
- co-agent 어댑터: co-agent 플러그인 `references/ai-cli-adapters.md`, `references/consensus-mode.md`
- 패널 컨텍스트: `AGENTS.md`(Codex), `GEMINI.md`(미사용), `CLAUDE.md`(Kiro/Claude)
