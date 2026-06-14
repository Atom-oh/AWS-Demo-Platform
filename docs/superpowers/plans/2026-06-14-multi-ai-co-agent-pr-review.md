# Multi-AI co-agent PR Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR 리뷰를 Codex + Kiro×3 패널 + Claude Opus 4.8 의장 종합 구조로 확장하고, 러너 이미지를 이 repo가 소유하도록 이관한다.

**Architecture:** self-hosted ARC 러너(ap-northeast-2)에 `codex`/`kiro-cli`를 baking한 이미지를 이 repo에서 빌드→ECR push. `pr-review.yml`이 `scripts/pr-review/run-panel.sh`로 패널을 병렬 fan-out(슬롯 파일 기록, timeout+비대화형으로 no-hang)하고, `synthesize.sh`가 Claude Opus 4.8로 종합해 단일 리뷰+VERDICT 생성. Codex는 Bedrock us-east-2 네이티브(config.toml), Kiro는 KIRO_API_KEY(Secrets Manager→ExternalSecret).

**Tech Stack:** GitHub Actions(self-hosted ARM64), Docker buildx, Terraform 1.9.8(AWS provider), AWS Bedrock, External Secrets Operator(v1), ArgoCD ApplicationSet(gha-runner-scale-set), bash.

**Spec:** `docs/superpowers/specs/2026-06-14-multi-ai-co-agent-pr-review-design.md`

---

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `docker/actions-runner-claude/Dockerfile` | 러너 이미지(claude+codex+kiro-cli+config.toml) | Create |
| `docker/actions-runner-claude/config.toml` | Codex Bedrock 설정(이미지에 COPY) | Create |
| `docker/actions-runner-claude/README.md` | 이미지 빌드/검증 메모 | Create |
| `.github/workflows/runner-image.yml` | ARM64 빌드→OIDC→ECR push | Create |
| `infra/ecr/main.tf` | `actions-runner-claude` ECR 레포 편입 | Modify |
| `infra/iam/*.tf` | 러너 노드 역할에 us-east-2 Bedrock 권한 | Modify (위치는 Task 0에서 확정) |
| `infra/secrets-manager/main.tf` | `/demo-platform/kiro/api-key` 슬롯 | Modify |
| `k8s/system/actions-runner/kiro-externalsecret.yaml` | KIRO_API_KEY ExternalSecret | Create |
| `argocd-apps/system/appset-helm-runner-claude-arm-aws-demo-platform.yaml` | 러너 env에 KIRO_API_KEY | Modify |
| `scripts/pr-review/run-panel.sh` | 패널 병렬 fan-out | Create |
| `scripts/pr-review/synthesize.sh` | Claude 의장 종합 | Create |
| `scripts/pr-review/lib.sh` | 공용 헬퍼(슬롯/스킵 로깅) | Create |
| `tests/pr-review/test-run-panel.sh` | run-panel 단위 테스트(바이너리 모킹) | Create |
| `.github/workflows/pr-review.yml` | 단일 리뷰→패널+종합 교체 | Modify |
| `docs/decisions/ADR-007-multi-ai-pr-review-panel.md` | 결정 기록 | Create |

---

## Phase 0 — Discovery & Local Validation

> 환경 의존 사실을 확정한다. 각 스텝은 "명령 실행 → 결과를 이 플랜/PR 설명에 기록"이다. 이후 태스크가 이 값들을 사용한다.

### Task 0: 환경 사실 확정

**Files:** 없음(조사). 결과는 PR 설명 또는 `docker/actions-runner-claude/README.md`에 기록.

- [ ] **Step 1: 현행 러너 이미지의 도구 패리티 추출**

허브 클러스터 컨텍스트 확인 후 실행 중인 러너 pod에서 버전 수집:
```bash
kubectl config current-context   # mall-apne2-mgmt 인지 확인
POD=$(kubectl get pods -n actions-runner-system -l actions.github.com/scale-set-name=aws-demo-platform-claude-arm -o name | head -1)
# pod가 0개(minRunners=0)면 일시적으로 워크플로 1개 트리거하거나 아래를 docker로 직접 실행
kubectl exec -n actions-runner-system "$POD" -- sh -c 'claude --version; gh --version; aws --version; node --version; git --version' 2>&1 || true
```
pod가 없으면 ECR 이미지를 직접 받아 확인:
```bash
aws ecr get-login-password --region ap-northeast-2 | sudo docker login --username AWS --password-stdin 180294183052.dkr.ecr.ap-northeast-2.amazonaws.com
sudo docker run --rm --platform=linux/arm64 180294183052.dkr.ecr.ap-northeast-2.amazonaws.com/actions-runner-claude:latest sh -c 'claude --version; gh --version; aws --version; node --version; cat /etc/os-release | head -2'
```
기록: 베이스 OS, claude/gh/aws/node/git 버전 → Dockerfile 패리티 기준.

- [ ] **Step 2: codex ARM64 설치 방법 확정**

이미지 후보로 검증(npm 우선, 실패 시 릴리스 바이너리):
```bash
sudo docker run --rm --platform=linux/arm64 node:22-bookworm sh -c 'npm i -g @openai/codex && codex --version'
```
성공하면 설치 명령 = `npm i -g @openai/codex`. 실패하면 GitHub releases의 `codex-aarch64-unknown-linux-*` 바이너리 URL을 기록.

- [ ] **Step 3: kiro-cli ARM64 설치 방법 확정**

```bash
# 공식 설치 스크립트/바이너리 경로 확인 (둘 중 동작하는 것 기록)
curl -fsSL https://kiro.dev/install.sh -o /tmp/kiro-install.sh 2>&1 | head || true
# 또는 AWS 배포 채널 확인 후, arm64 바이너리 URL과 설치 위치(/usr/local/bin/kiro-cli)를 기록
```
기록: 설치 명령 + 바이너리명이 정확히 `kiro-cli`인지(`kiro` 아님).

- [ ] **Step 4: Kiro 모델 ID 확정**

`KIRO_API_KEY`가 있는 환경에서:
```bash
KIRO_API_KEY=<key> kiro-cli --list-models 2>&1
```
기록: `opus`, `kimi-k2.5`(또는 `[Internal]` 표기), `glm-5`(또는 `glm-4.6`)의 정확한 ID. 패널 모델 배열에 사용.

- [ ] **Step 5: Codex 비대화형 승인 키 확정**

```bash
sudo docker run --rm --platform=linux/arm64 -e AWS_REGION=us-east-2 \
  -v $HOME/.aws:/root/.aws:ro node:22-bookworm sh -c \
  'npm i -g @openai/codex >/dev/null 2>&1; mkdir -p ~/.codex; printf "model=\"openai.gpt-5.5\"\nmodel_provider=\"amazon-bedrock\"\napproval_policy=\"never\"\n[model_providers.amazon-bedrock.aws]\nregion=\"us-east-2\"\n" > ~/.codex/config.toml; echo "test diff" | timeout 60 codex exec -s read-only "summarize in one line" < /dev/null'
```
기록: `approval_policy = "never"`가 유효 키인지, 프롬프트 hang 없이 종료되는지. 유효 키를 `config.toml`에 확정.

- [ ] **Step 6: 러너 노드 IAM 역할 위치 확정**

```bash
# 러너 pod가 쓰는 노드의 인스턴스 프로파일/역할 식별
kubectl get nodes -l workload-type=ci-runner -o jsonpath='{.items[*].metadata.name}'  # 또는 node-pool 라벨
grep -rn "iam_role\|node.*role\|instance_profile\|InstanceProfile" infra/eks-mgmt/*.tf k8s/system/karpenter/*.yaml 2>/dev/null | head
```
기록: 노드 역할 ARN과 정의 위치(이 repo `infra/eks-mgmt` 또는 Karpenter NodeRole, 혹은 mra). Task 4(IAM)가 이 위치를 수정.

- [ ] **Step 7: 결과 커밋**

```bash
git add docker/actions-runner-claude/README.md 2>/dev/null || true
git commit -m "docs(runner-image): record discovery facts (codex/kiro install, model ids, node role)" --allow-empty
```

---

## Phase 1 — Runner Image (this repo)

### Task 1: Codex config.toml

**Files:**
- Create: `docker/actions-runner-claude/config.toml`

- [ ] **Step 1: config.toml 작성** (Task 0.5에서 확정한 approval 키 반영)

```toml
# Codex CLI — Bedrock 네이티브. 러너 노드 IAM 자격증명 사용(us-east-2).
model = "openai.gpt-5.5"
model_provider = "amazon-bedrock"
model_reasoning_effort = "xhigh"
approval_policy = "never"

[model_providers.amazon-bedrock.aws]
region = "us-east-2"
```

- [ ] **Step 2: 커밋**

```bash
git add docker/actions-runner-claude/config.toml
git commit -m "feat(runner-image): codex bedrock config.toml"
```

### Task 2: Dockerfile

**Files:**
- Create: `docker/actions-runner-claude/Dockerfile`

- [ ] **Step 1: Dockerfile 작성** (베이스 태그/설치 명령은 Task 0.1~0.3 결과로 확정)

```dockerfile
# 현행 actions-runner-claude 와 패리티 유지(claude-code, gh, aws, node, git 포함).
# 기존 published 이미지를 베이스로 codex/kiro-cli 만 얹어 회귀 위험 최소화.
FROM 180294183052.dkr.ecr.ap-northeast-2.amazonaws.com/actions-runner-claude:latest

USER root

# Codex (Task 0.2 결과: npm 경로. 바이너리 경로면 이 RUN 을 교체)
RUN npm install -g @openai/codex \
    && codex --version

# Kiro CLI (Task 0.3 결과로 확정된 설치 명령으로 교체)
#   예시(스크립트 설치): RUN curl -fsSL https://kiro.dev/install.sh | sh && kiro-cli --version
#   예시(바이너리):     RUN curl -fsSL <arm64-url> -o /usr/local/bin/kiro-cli && chmod +x /usr/local/bin/kiro-cli && kiro-cli --version
RUN curl -fsSL https://kiro.dev/install.sh | sh \
    && kiro-cli --version

# Codex Bedrock 설정 baking
COPY config.toml /home/runner/.codex/config.toml
RUN chown -R runner:runner /home/runner/.codex

USER runner
```

- [ ] **Step 2: 로컬 ARM64 빌드 검증**

Run:
```bash
cd docker/actions-runner-claude
aws ecr get-login-password --region ap-northeast-2 | sudo docker login --username AWS --password-stdin 180294183052.dkr.ecr.ap-northeast-2.amazonaws.com
sudo docker build --platform=linux/arm64 -t actions-runner-claude:multi-ai-test .
sudo docker run --rm --platform=linux/arm64 actions-runner-claude:multi-ai-test sh -c 'claude --version && codex --version && kiro-cli --version && cat /home/runner/.codex/config.toml'
```
Expected: 세 CLI 버전 모두 출력 + config.toml 내용 출력.

- [ ] **Step 3: 커밋**

```bash
git add docker/actions-runner-claude/Dockerfile
git commit -m "feat(runner-image): Dockerfile adds codex + kiro-cli on actions-runner-claude base"
```

### Task 3: ECR 레포 TF 편입 + 빌드 워크플로

**Files:**
- Modify: `infra/ecr/main.tf`
- Create: `.github/workflows/runner-image.yml`
- Create: `docker/actions-runner-claude/README.md`

- [ ] **Step 1: 기존 ECR 레포 목록/구조 확인**

Run: `sed -n '1,40p' infra/ecr/main.tf`
Expected: `for_each` 대상 set/map과 레포 리소스 구조 파악.

- [ ] **Step 2: `actions-runner-claude` 를 for_each 목록에 추가**

`infra/ecr/main.tf`의 레포 이름 목록(예: `local.repositories` 또는 변수)에 `"actions-runner-claude"` 추가. 정확한 위치는 Step 1 구조에 맞춰 수정.

- [ ] **Step 3: import 필요 여부 plan 확인**

Run:
```bash
cd infra/ecr && terraform init && terraform plan
```
Expected: `actions-runner-claude` 가 `to be created` 로 뜨면, 실제 레포가 이미 존재하므로 import 필요:
```bash
terraform import 'aws_ecr_repository.this["actions-runner-claude"]' actions-runner-claude
terraform plan   # no changes 확인
```
(리소스 주소는 Step 1 구조에 맞춤.)

- [ ] **Step 4: 빌드 워크플로 작성**

`.github/workflows/runner-image.yml`:
```yaml
name: Build Runner Image
on:
  push:
    branches: [main]
    paths: ['docker/actions-runner-claude/**']
  workflow_dispatch:
jobs:
  build:
    runs-on: aws-demo-platform-arm
    permissions:
      id-token: write
      contents: read
    env:
      ECR_REGISTRY: 180294183052.dkr.ecr.ap-northeast-2.amazonaws.com
      REPO: actions-runner-claude
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::180294183052:role/demo-platform-gha-ecr-push
          aws-region: ap-northeast-2
      - uses: aws-actions/amazon-ecr-login@v2
      - name: Build & push (native ARM64)
        run: |
          set -euo pipefail
          SHA="${GITHUB_SHA::12}"
          docker build --platform=linux/arm64 \
            -t "$ECR_REGISTRY/$REPO:latest" \
            -t "$ECR_REGISTRY/$REPO:$SHA" \
            docker/actions-runner-claude
          docker push "$ECR_REGISTRY/$REPO:latest"
          docker push "$ECR_REGISTRY/$REPO:$SHA"
```

- [ ] **Step 5: README 작성**(Task 0 결과 + 빌드/스모크 메모)

`docker/actions-runner-claude/README.md`에 베이스 패리티 버전, codex/kiro 설치 명령, 스모크 테스트 명령, `kiro-cli --list-models` 결과를 기록.

- [ ] **Step 6: 커밋**

```bash
git add infra/ecr/main.tf .github/workflows/runner-image.yml docker/actions-runner-claude/README.md
git commit -m "feat(runner-image): ECR repo TF + ARM64 build workflow"
```

> **체크포인트:** 이 PR 머지 후 `runner-image.yml` 1회 실행 → 새 이미지 push 확인. 러너는 `:latest` 풀이므로 다음 스케일업부터 codex/kiro 포함. (ArgoCD appset 변경 없음.)

---

## Phase 2 — IAM (Codex → Bedrock us-east-2)

### Task 4: 러너 노드 역할에 us-east-2 Bedrock 권한

**Files:**
- Modify: Task 0.6에서 확정한 노드 역할 정책 파일(예: `infra/eks-mgmt/*.tf` 또는 별도 정책)

- [ ] **Step 1: 현행 Bedrock 정책 확인**

Run: `grep -rn "bedrock" infra/ 2>/dev/null | grep -v .terraform`
Expected: 현재 ap-northeast-2 Claude 권한 statement 위치 파악.

- [ ] **Step 2: us-east-2 statement 추가**

해당 IAM 정책 문서에 statement 추가:
```hcl
statement {
  sid     = "BedrockCodexUsEast2"
  effect  = "Allow"
  actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
  resources = [
    "arn:aws:bedrock:us-east-2::foundation-model/openai.gpt-5.5*",
    "arn:aws:bedrock:us-east-2:180294183052:inference-profile/*openai.gpt-5.5*",
  ]
}
```
(기존 ap-northeast-2 Claude statement는 유지.)

- [ ] **Step 3: plan 확인**

Run: `cd <module> && terraform plan`
Expected: 정책에 statement 1개 추가만 표시.

- [ ] **Step 4: 커밋**

```bash
git add <module>/*.tf
git commit -m "feat(iam): runner node role can invoke openai.gpt-5.5 in us-east-2 (Codex)"
```

> **체크포인트:** apply 후 러너에서 Task 0.5 라이브 검증 재실행 → Codex가 Bedrock us-east-2 호출 성공 확인.

---

## Phase 3 — Kiro Secret Wiring

### Task 5: Secrets Manager 슬롯

**Files:**
- Modify: `infra/secrets-manager/main.tf`

- [ ] **Step 1: 기존 시크릿 슬롯 패턴 확인**

Run: `sed -n '1,60p' infra/secrets-manager/main.tf`
Expected: github PAT/argocd token/cognito 슬롯 정의 패턴(이름/리소스) 파악.

- [ ] **Step 2: kiro 슬롯 추가**

기존 패턴에 맞춰 `/demo-platform/kiro/api-key` 시크릿 리소스 추가. 값은 관리하지 않음(슬롯만):
```hcl
resource "aws_secretsmanager_secret" "kiro_api_key" {
  name        = "/demo-platform/kiro/api-key"
  description = "Kiro CLI API key for PR review panel"
}
```
(파일의 기존 네이밍/태그 컨벤션 따름.)

- [ ] **Step 3: plan + apply + 값 주입**

```bash
cd infra/secrets-manager && terraform plan && terraform apply
aws secretsmanager put-secret-value --secret-id /demo-platform/kiro/api-key \
  --secret-string '{"KIRO_API_KEY":"<실제키>"}' --region ap-northeast-2
```

- [ ] **Step 4: 커밋**

```bash
git add infra/secrets-manager/main.tf
git commit -m "feat(secrets): /demo-platform/kiro/api-key slot"
```

### Task 6: ExternalSecret + 러너 env

**Files:**
- Create: `k8s/system/actions-runner/kiro-externalsecret.yaml`
- Modify: `argocd-apps/system/appset-helm-runner-claude-arm-aws-demo-platform.yaml`

- [ ] **Step 1: 기존 ExternalSecret 참고**

Run: `find k8s -name '*externalsecret*' -o -name '*external-secret*' 2>/dev/null | head; cat k8s/system/atlantis/*secret*.yaml 2>/dev/null`
Expected: `ClusterSecretStore` 이름(`aws-secrets-manager`), `external-secrets.io/v1` 구조 확인.

- [ ] **Step 2: ExternalSecret 작성**

`k8s/system/actions-runner/kiro-externalsecret.yaml`:
```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: kiro-api-key
  namespace: actions-runner-system
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: kiro-api-key
    creationPolicy: Owner
  data:
    - secretKey: KIRO_API_KEY
      remoteRef:
        key: /demo-platform/kiro/api-key
        property: KIRO_API_KEY
```

- [ ] **Step 3: ArgoCD가 이 매니페스트를 동기화하도록 연결 확인**

Run: `grep -rn "actions-runner" argocd-apps/system/*.yaml | grep -i "path\|appset" | head`
Expected: `actions-runner-system` 대상 Application/AppSet 경로 확인. ExternalSecret이 동기화되도록 적절한 Application source path에 위치(없으면 기존 system kustomize 경로에 편입). 매니페스트 검증:
```bash
kubectl apply --dry-run=client -f k8s/system/actions-runner/kiro-externalsecret.yaml
```

- [ ] **Step 4: 러너 appset에 env 추가**

`appset-helm-runner-claude-arm-aws-demo-platform.yaml`의 `template.spec.containers` 중 `name: runner` 항목에 추가:
```yaml
                    env:
                      - name: KIRO_API_KEY
                        valueFrom:
                          secretKeyRef:
                            name: kiro-api-key
                            key: KIRO_API_KEY
```

- [ ] **Step 5: 커밋**

```bash
git add k8s/system/actions-runner/kiro-externalsecret.yaml argocd-apps/system/appset-helm-runner-claude-arm-aws-demo-platform.yaml
git commit -m "feat(runner): KIRO_API_KEY via ExternalSecret -> runner env"
```

> **체크포인트:** ArgoCD sync 후 `kubectl get secret kiro-api-key -n actions-runner-system` 존재 확인. 러너에서 `kiro-cli chat "ping" --model opus --no-interactive` 성공 확인.

---

## Phase 4 — Orchestration (scripts + workflow)

### Task 7: 공용 라이브러리 lib.sh

**Files:**
- Create: `scripts/pr-review/lib.sh`

- [ ] **Step 1: lib.sh 작성**

```bash
#!/usr/bin/env bash
# 공용 헬퍼: 슬롯 디렉터리, 스킵 로깅.
set -uo pipefail

# slot 디렉터리 보장
ensure_slots() { mkdir -p "$1/slot"; }

# 한 패널 실행 결과를 평가해 responded 에 기록.
#   $1 slot 파일 경로, $2 패널 라벨, $3 responded 파일
record_result() {
  local slot="$1" label="$2" responded="$3"
  if [ -s "$slot" ]; then
    echo "$label" >> "$responded"
  else
    echo "[skip] $label" >&2
    : > "$slot"  # 빈 슬롯 보장
  fi
}
```

- [ ] **Step 2: 커밋**

```bash
git add scripts/pr-review/lib.sh
git commit -m "feat(pr-review): shared lib for panel slots"
```

### Task 8: run-panel.sh + 단위 테스트 (TDD)

**Files:**
- Create: `tests/pr-review/test-run-panel.sh`
- Create: `scripts/pr-review/run-panel.sh`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/pr-review/test-run-panel.sh`:
```bash
#!/usr/bin/env bash
# run-panel.sh 단위 테스트. 실제 CLI 대신 PATH 모킹으로 (a)전원응답 (b)일부skip (c)전원skip 검증.
set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")/../../scripts/pr-review" && pwd)/run-panel.sh"
fail=0
mkfake() { # $1 binname, $2 exitcode, $3 output
  cat > "$BIN/$1" <<EOF
#!/usr/bin/env bash
[ "$2" -eq 0 ] && echo "$3"
exit $2
EOF
  chmod +x "$BIN/$1"
}
setup() { WORK=$(mktemp -d); BIN=$(mktemp -d); export PATH="$BIN:$PATH"
  echo "diff --git a b" > "$WORK/diff.txt"; echo "review this" > "$WORK/prompt.txt"; }

# (a) 전원 응답
setup; mkfake codex 0 "codex-finding"; mkfake kiro-cli 0 "kiro-finding"
"$SCRIPT" "$WORK/diff.txt" "$WORK/prompt.txt" "$WORK" >/dev/null 2>&1
for f in codex kiro-opus kiro-kimi kiro-glm; do
  [ -s "$WORK/slot/$f.md" ] || { echo "FAIL(a): $f.md empty"; fail=1; }
done
[ "$(wc -l < "$WORK/responded.txt")" -eq 4 ] || { echo "FAIL(a): responded != 4"; fail=1; }

# (b) kiro 전체 실패(codex만 응답)
setup; mkfake codex 0 "codex-finding"; mkfake kiro-cli 1 ""
"$SCRIPT" "$WORK/diff.txt" "$WORK/prompt.txt" "$WORK" >/dev/null 2>&1
grep -q "codex" "$WORK/responded.txt" || { echo "FAIL(b): codex missing"; fail=1; }
grep -q "kiro" "$WORK/responded.txt" && { echo "FAIL(b): kiro should skip"; fail=1; }

# (c) 전원 실패 → responded 비어야 함 (결정론적: 모든 모킹 exit 1)
setup; mkfake codex 1 ""; mkfake kiro-cli 1 ""
"$SCRIPT" "$WORK/diff.txt" "$WORK/prompt.txt" "$WORK" >/dev/null 2>&1
[ -f "$WORK/responded.txt" ] && [ ! -s "$WORK/responded.txt" ] || { echo "FAIL(c): responded should be empty"; fail=1; }

[ "$fail" -eq 0 ] && echo "PASS: test-run-panel" || exit 1
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `bash tests/pr-review/test-run-panel.sh`
Expected: FAIL — `run-panel.sh` 없음(`No such file`).

- [ ] **Step 3: run-panel.sh 구현**

`scripts/pr-review/run-panel.sh` (Task 0.4 모델 ID 반영):
```bash
#!/usr/bin/env bash
# 패널 병렬 fan-out. 인자: <diff> <prompt> <workdir>
# no-hang: 비대화형 플래그 + timeout + stdin 격리(diff 파이프).
set -uo pipefail
DIFF="$1"; PROMPT_FILE="$2"; WORK="$3"
DIR="$(cd "$(dirname "$0")" && pwd)"; . "$DIR/lib.sh"
ensure_slots "$WORK"
SLOT="$WORK/slot"; RESP="$WORK/responded.txt"; : > "$RESP"
T="${PANEL_TIMEOUT:-300}"
PROMPT="$(cat "$PROMPT_FILE")"
KIRO_MODELS=("opus" "kimi-k2.5" "glm-5")   # Task 0.4 결과로 확정

# Codex (Bedrock, config.toml). stdin=diff, 비대화형 exec.
if command -v codex >/dev/null 2>&1; then
  ( cat "$DIFF" | timeout "$T" codex exec -s read-only "$PROMPT" > "$SLOT/codex.md" 2>"$SLOT/codex.err" || true ) &
else echo "[skip] codex (binary absent)" >&2; : > "$SLOT/codex.md"; fi

# Kiro x3
for m in "${KIRO_MODELS[@]}"; do
  tag="kiro-${m%%-*}"  # opus->kiro-opus, kimi-k2.5->kiro-kimi, glm-5->kiro-glm
  if command -v kiro-cli >/dev/null 2>&1; then
    ( cat "$DIFF" | timeout "$T" kiro-cli chat "$PROMPT" --model "$m" \
        --no-interactive --trust-tools=read,grep --wrap never \
        > "$SLOT/$tag.md" 2>"$SLOT/$tag.err" </dev/null || true ) &
  else echo "[skip] $tag (binary absent)" >&2; : > "$SLOT/$tag.md"; fi
done
wait

# 결과 집계
record_result "$SLOT/codex.md"     "codex"     "$RESP"
record_result "$SLOT/kiro-opus.md" "kiro-opus" "$RESP"
record_result "$SLOT/kiro-kimi.md" "kiro-kimi" "$RESP"
record_result "$SLOT/kiro-glm.md"  "kiro-glm"  "$RESP"
echo "Panel responded: $(tr '\n' ' ' < "$RESP")"
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bash tests/pr-review/test-run-panel.sh`
Expected: `PASS: test-run-panel`

- [ ] **Step 5: 커밋**

```bash
git add scripts/pr-review/run-panel.sh tests/pr-review/test-run-panel.sh
git commit -m "feat(pr-review): run-panel.sh fan-out + unit tests"
```

### Task 9: synthesize.sh

**Files:**
- Create: `scripts/pr-review/synthesize.sh`

- [ ] **Step 1: synthesize.sh 작성**

```bash
#!/usr/bin/env bash
# 의장 종합. 인자: <diff> <workdir> <pr_number> <pr_title> <out review.md>
set -euo pipefail
DIFF="$1"; WORK="$2"; PR_NUMBER="$3"; PR_TITLE="$4"; OUT="$5"
SLOT="$WORK/slot"
RESP="$(tr '\n' ',' < "$WORK/responded.txt" 2>/dev/null | sed 's/,$//')"
[ -z "$RESP" ] && RESP="(none — Claude solo)"

# 패널 출력 합본
PANEL=""
for f in "$SLOT"/*.md; do
  [ -s "$f" ] || continue
  PANEL+="

=== 패널: $(basename "$f" .md) ===
$(cat "$f")"
done

cat > "$WORK/synth-prompt.txt" <<PROMPT_EOF
You are the CHAIR reviewing PR #${PR_NUMBER}: ${PR_TITLE}.
Read CLAUDE.md + docs/architecture.md + .claude/skills/code-review/SKILL.md.
Below are independent panel reviews (Codex, Kiro models) of the diff.
패널: ${RESP}

Synthesize ONE final review:
1. **Summary** (2-3 sentences in Korean)
2. **Issues** — CRITICAL/MAJOR/MINOR. 패널 간 합의/이견을 표시.
3. **Suggestions**
4. **Verdict**

Project rules (AWS-Demo-Platform): CloudFront-only ingress(TGB), Internal ALB SG=CF VPC Origin SG+10/8, ACM data lookup(*.atomai.click), HPA-2(min=max=1), Atlantis --write-git-creds, ExternalSecret external-secrets.io/v1, cross-account ExternalId, kube context safety, Terraform 1.9.8 pin, naming demo-platform-*/\/demo-platform/*, ADR Mermaid+bilingual.
한국어+영문 기술용어 혼용. Output ONLY the review markdown.
IMPORTANT: 마지막 줄은 정확히 하나:
  VERDICT: PASS
  VERDICT: FAIL
CRITICAL/MAJOR 있으면 FAIL, 아니면 PASS.

=== PANEL REVIEWS ===
${PANEL}
PROMPT_EOF

# claude 실패해도 fallback 이 돌도록 || true (set -e 우회)
cat "$DIFF" | claude -p "$(cat "$WORK/synth-prompt.txt")" --output-format text > "$OUT" || true
if [ ! -s "$OUT" ]; then
  echo "리뷰 생성 실패 — Claude CLI가 빈 응답을 반환했습니다." > "$OUT"
  echo "VERDICT: FAIL" >> "$OUT"
fi
echo "Synthesis: $(wc -c < "$OUT") bytes (panel: ${RESP})"
```

- [ ] **Step 2: 구문 검사**

Run: `bash -n scripts/pr-review/synthesize.sh && echo OK`
Expected: `OK`

- [ ] **Step 3: 커밋**

```bash
git add scripts/pr-review/synthesize.sh
git commit -m "feat(pr-review): synthesize.sh chair synthesis"
```

### Task 10: pr-review.yml 교체

**Files:**
- Modify: `.github/workflows/pr-review.yml`

- [ ] **Step 1: CLI 존재 확인 스텝 확장**

기존 "Verify Claude Code CLI present" 스텝에 추가(비차단 warning):
```bash
          for c in codex kiro-cli; do
            command -v "$c" >/dev/null 2>&1 || echo "::warning::$c not found on runner (image needs rebuild)"
          done
```

- [ ] **Step 2: "Review with Claude Code" 단일 스텝을 패널+종합으로 교체**

기존 step(76–132행 상당)을 다음 두 스텝으로 교체. diff 준비/필터(50–74행)와 게이트(134–147행)·코멘트(149–183행)는 유지.
```yaml
      - name: Build panel prompt
        run: |
          set -euo pipefail
          MAX_LINES=3000
          head -"$MAX_LINES" /tmp/pr-diff.txt > /tmp/pr-diff-truncated.txt
          cat <<'PROMPT_EOF' > /tmp/panel-prompt.txt
          Review the diff provided via stdin for bugs, security risks, logic errors,
          and convention violations. Output concise findings grouped CRITICAL/MAJOR/MINOR.
          DO NOT output a VERDICT line — that is the chair's job.
          한국어+영문 기술용어 혼용 가능.
          PROMPT_EOF

      - name: Run panel + synthesize
        env:
          PR_NUMBER: ${{ github.event.pull_request.number }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PANEL_TIMEOUT: "300"
        run: |
          set -euo pipefail
          mkdir -p /tmp/pr-review
          bash scripts/pr-review/run-panel.sh /tmp/pr-diff-truncated.txt /tmp/panel-prompt.txt /tmp/pr-review
          bash scripts/pr-review/synthesize.sh /tmp/pr-diff-truncated.txt /tmp/pr-review \
            "$PR_NUMBER" "$PR_TITLE" /tmp/review.md
          echo "panel_responded=$(tr '\n' ' ' < /tmp/pr-review/responded.txt 2>/dev/null)" >> "$GITHUB_ENV"
```

- [ ] **Step 3: 코멘트에 Panel 줄 추가**

"Post review comment" 스텝의 comment.md 빌드 블록에 추가(헤더 아래):
```bash
            echo "_Panel: Claude(chair) · ${panel_responded:-solo}_"
            echo ""
```

- [ ] **Step 4: 워크플로 구문 검증**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pr-review.yml')); print('yaml ok')"`
Expected: `yaml ok`

- [ ] **Step 5: 커밋**

```bash
git add .github/workflows/pr-review.yml
git commit -m "feat(pr-review): replace single review with panel fan-out + chair synthesis"
```

---

## Phase 5 — E2E + Docs

### Task 11: ADR + 문서 동기화

**Files:**
- Create: `docs/decisions/ADR-007-multi-ai-pr-review-panel.md`
- Modify: `CLAUDE.md`(PR automation 설명), `docs/architecture.md`

- [ ] **Step 1: ADR 작성** (Mermaid + 한/영 구조, 템플릿 준수)

ADR-007에 결정: 멀티 AI 패널(Codex+Kiro×3) + Claude 의장 종합, Codex Bedrock us-east-2, Kiro Secrets Manager, 러너 이미지 이관, 러너는 ap-northeast-2 유지(크로스리전 IAM) 근거 포함. Mermaid로 §5 데이터 흐름 도식화.

- [ ] **Step 2: CLAUDE.md / architecture.md 갱신**

`CLAUDE.md`의 PR automation 항목에 멀티 AI 패널 설명 추가. `docs/architecture.md`에 runner-image 빌드 경로 + ECR 레포 추가 반영.

- [ ] **Step 3: 커밋**

```bash
git add docs/decisions/ADR-007-multi-ai-pr-review-panel.md CLAUDE.md docs/architecture.md
git commit -m "docs(adr): ADR-007 multi-AI PR review panel + sync CLAUDE/architecture"
```

### Task 12: E2E 검증

**Files:** 없음(검증).

- [ ] **Step 1: tests/run-all.sh 회귀**

Run: `bash tests/run-all.sh`
Expected: 통과(또는 사전 실패와 동일).

- [ ] **Step 2: 테스트 PR로 E2E**

이미지 재빌드 + 시크릿/IAM apply 완료 후, 작은 변경으로 PR 생성 → `pr-review.yml` 실행 → 코멘트 1개에 Panel 줄(codex/kiro 응답) + 정상 VERDICT 확인. 패널 일부 skip 시에도 코멘트 정상 생성 확인.

- [ ] **Step 3: 최종 상태 확인**

Run: `gh pr checks <PR>` / 코멘트 육안 검토.
Expected: 게이트 정상 동작(PASS/FAIL), upsert 1개 유지.

---

## 의존성 / 실행 순서

```
Phase 0 (discovery) ──► Phase 1 (image) ──► [merge + build] ──► Phase 2 (IAM apply) ──┐
                                                              └► Phase 3 (secret apply)─┤
                                                                                        ▼
                                                              Phase 4 (scripts/workflow) ──► Phase 5 (E2E+docs)
```
- Phase 4 스크립트는 이미지·IAM·시크릿과 독립적으로 작성/단위테스트 가능하나, **E2E는 1~3 적용 후** 가능.
- Phase 1 머지 후 빌드 워크플로 1회 실행 + 러너 스케일업 전까지 codex/kiro 미존재 → Phase 4의 graceful skip로 안전.
