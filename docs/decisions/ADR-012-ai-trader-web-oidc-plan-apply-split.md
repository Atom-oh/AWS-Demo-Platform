# ADR-012: ai-trader-web Terraform OIDC — Plan/Apply Privilege Split

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status

Accepted (2026-07-12). Extends the OIDC least-privilege convention already used by
`demo-platform-gha-ecr-push` (`infra/iam/gha-ecr-push-role.tf`) to a cross-repo,
higher-privilege case: the external `Atom-oh/ai-trader-web` repo's `terraform.yml`.

## Context

`ai-trader-web` runs its own `terraform.yml` (plan on PR/push, apply on push to `main` +
`workflow_dispatch`, apply job bound to a GitHub `environment: prod`). It manages IAM, ECS,
CloudFront, Cognito, NLB, Lambda@Edge, AgentCore — so its Terraform needs broad, effectively
account-admin permissions to apply. The repo already assumes `ai-trader-web-gha-deploy`
(`PowerUserAccess`), which cannot manage IAM; the ask was an **admin** role.

The naive design — one `AdministratorAccess` role whose trust lists all three subs
(`pull_request`, `ref:refs/heads/main`, `environment:prod`) — has a critical flaw the PR-review
panel (5/5 models, PR #69) independently surfaced:

**`terraform plan` executes code from the PR branch.** Provider plugins, `external` data
sources, and `data` lookups all run during plan. If the `pull_request` sub can assume an
admin role, then *anyone who can open a PR* against ai-trader-web (a repo collaborator, or an
attacker who compromises any CI dependency the plan step resolves) runs arbitrary code with
account-admin credentials — completely bypassing the `environment: prod` approval gate, whose
whole purpose is to require a human review before privileged actions. Pinning trust to "exact
subs" fixes *who* assumes the role but not *what code* executes under it.

This account hosts the entire demo-platform (EKS hub, Atlantis, Terraform state bucket), so
the blast radius of a compromised admin assume-path is platform-wide.

## Decision

Split into two roles (`infra/iam/ai-trader-web-gha-roles.tf`):

| Role | Managed policy | Trust (`sub`) | Used by |
|------|----------------|---------------|---------|
| `ai-trader-web-terraform-plan` | `ReadOnlyAccess` **+ inline Deny on demo-platform data** | `pull_request`, `ref:refs/heads/main` | plan job |
| `ai-trader-web-terraform-admin` | `AdministratorAccess` | `ref:refs/heads/main` only (IAM-enforced branch gate) | apply job |

- The plan job (attacker-influenceable) can only read, and ai-trader-web uses **local**
  Terraform state, so the plan role needs no permissions on its *own* state.
- **But `ReadOnlyAccess` grants `s3:Get*` / `dynamodb:Scan` account-wide**, and this account
  hosts the *shared, platform-wide* Terraform state (bucket `multi-region-mall-terraform-state`
  + lock table, may contain plaintext secrets) plus the demo-platform Lifecycle Controller
  DynamoDB tables. Since the plan role is assumable by attacker-controlled PR-branch code,
  "read-only" is not by itself safe — it would be a demo-platform-data exfiltration path. An
  **inline Deny** on the state bucket/lock table + a `demo-platform-*` DynamoDB wildcard (an IAM
  resource wildcard `*` matches `/`, so `table/demo-platform-*` already spans the `.../index/*`
  GSI ARNs that `dynamodb:Query` authorizes on — the explicit `/index/*` line is a defensive
  duplicate) + a `/demo-platform/*` CloudWatch Logs Deny (`logs:*` — blocks `StartQuery` +
  `StartLiveTail`, the log-group-scoped read entry points, not just `GetLogEvents`) + a
  `demo-platform-*` SQS Deny (job queue + DLQ) + a `demo-platform/*` + `actions-runner-claude`
  ECR image Deny (a pulled layer can carry baked source/config) + a Cognito read Deny on the
  admin user pool covers the sensitive demo-platform stores, while ai-trader-web's own resources
  (it deploys into this same account, under `ai-trader-*` names) stay readable for plan refresh.
  This is a **targeted denylist of demo-platform's sensitive stores, not a blanket seal** —
  `ReadOnlyAccess` still grants broad account-wide `Describe`/`List` metadata; the goal is to
  deny the stores that hold secrets or payloads, not every read. A permissions-boundary /
  scoped-allowlist rewrite would be more robust and is noted as future work.
  **Secret VALUES**: `ReadOnlyAccess` (v187) does NOT include `secretsmanager:GetSecretValue` —
  only `Describe*`/`List*`/`GetResourcePolicy` — so the operator/terraformer ExternalId, GitHub
  PAT, ArgoCD token, cognito, and AI panel key are already unreadable; an explicit
  `GetSecretValue` Deny on `/demo-platform/*` pins that so a future AWS-managed-policy change
  can't silently reopen the path. (The state bucket + lock table live in `us-east-1`, per
  `backend.tf` — the lock-table Deny ARN is pinned there, not `local.region`.)
- **The admin role is gated on the `ref:refs/heads/main` sub, NOT an `environment:prod` sub.**
  An environment sub would delegate the branch gate to GitHub environment protection — which
  this repo's billing plan cannot enforce (no required-reviewer / branch-restriction rules on
  a private repo: `gh api .../environments/prod` → `protection_rules: []`, `PUT` → HTTP 422).
  `ref:refs/heads/main` is part of the **sub** (a real IAM condition key — unlike the
  non-evaluable `ref` *claim*, which AWS STS does not expose; that is why `gha-ecr-push-role.tf`
  also encodes the ref inside the sub). So IAM itself restricts admin to code on `main` — no
  dependence on GitHub environment features. (The intent is that main is review-gated, but that
  is NOT enforceable here — see the ACCEPTED TRADE-OFF in Consequences.) The ai-trader-web apply
  job must therefore run on push/`workflow_dispatch` on main
  **without** an `environment:` binding (a binding would flip the sub to `environment:prod` and
  break this trust).
- `max_session_duration = 7200` on the admin role so long applies don't expire mid-run.
- Both roles reuse the shared `data.aws_iam_openid_connect_provider.github`.
- Naming keeps the `ai-trader-web-*` prefix (deliberate deviation from `demo-platform-*`) to
  pair with the pre-existing out-of-band `ai-trader-web-gha-deploy` role.

### Trust / privilege split

```mermaid
flowchart TD
    subgraph gh["Atom-oh/ai-trader-web · terraform.yml"]
        pr["plan job<br/>sub: pull_request<br/>+ ref:refs/heads/main"]
        ap["apply job<br/>sub: ref:refs/heads/main<br/>(push / dispatch on main, no environment)"]
    end
    oidc["token.actions.githubusercontent.com<br/>(shared OIDC provider)"]
    plan["ai-trader-web-terraform-plan<br/>ReadOnlyAccess + demo-platform-data Deny"]
    admin["ai-trader-web-terraform-admin<br/>AdministratorAccess · 2h session"]
    pr -->|OIDC AssumeRoleWithWebIdentity| oidc
    ap -->|OIDC AssumeRoleWithWebIdentity| oidc
    oidc -->|sub match| plan
    oidc -->|sub match: main only| admin
    pr -.->|"attacker-controlled plan code<br/>→ read-only, demo-platform data denied"| plan
    ap -.->|"code on main (push-gated,<br/>see trade-off)→ admin"| admin
```

## Consequences

- Attacker-controlled plan code is confined to read-only and cannot read demo-platform's
  state/data — the split can no longer be bypassed via the PR trigger.
- The admin gate is enforced **at the IAM layer** (`ref:refs/heads/main` sub), so it does not
  depend on GitHub environment protection — which this repo's plan cannot provide. Only code
  on `main` can assume admin. (Earlier revisions gated on `environment:prod`; dropped because
  the environment had no enforceable protection here — see the trust bullet above.)
- **ACCEPTED TRADE-OFF (2026-07-13): main branch protection is NOT enforceable on this repo
  either.** ai-trader-web is a private repo on a plan that supports neither environment
  protection nor branch protection / rulesets (`gh api .../branches/main/protection` → HTTP
  403 "Upgrade to GitHub Pro or make this repository public"). So the "only code merged to
  main, gated by review" gate is aspirational, not enforced: **anyone who can push to `main`
  (a collaborator, or a stolen collaborator credential) gets `AdministratorAccess` in this
  account with no review** — and this account hosts the whole platform (EKS hub, Atlantis,
  shared tfstate). This is accepted for now because (a) the plan/apply split already closed
  the arbitrary-PR path (the untrusted `plan` role is read-only + demo-platform-data-denied),
  (b) the residual path requires main-push rights, and (c) this is a non-production account.
  To actually close it: upgrade the plan (or make the repo public) and enable a
  required-review branch/ruleset on `main`, then this bullet can be retired. Until then, treat
  admin as gated only by ai-trader-web's collaborator list.
- Follow-up (ai-trader-web PR): `terraform.yml` plan job → `role-to-assume:
  arn:aws:iam::180294183052:role/ai-trader-web-terraform-plan`; apply job →
  `arn:aws:iam::180294183052:role/ai-trader-web-terraform-admin` (ARNs exported as
  `ai_trader_web_terraform_{plan,admin}_role_arn` outputs). Both jobs still need
  `permissions: id-token: write`. The apply job must run on push / `workflow_dispatch` on main
  **without** an `environment:` key (an environment binding changes the OIDC sub to
  `environment:prod` and the admin trust — pinned to the `ref:refs/heads/main` sub — would
  reject it). It must also set `role-duration-seconds: 7200` on `configure-aws-credentials`
  for the 2h session to take effect (the action defaults to 1h).
- ai-trader-web uses local state on ephemeral runners (state is lost each run); if it later
  adopts a remote backend, the plan role's shared-state Deny must be revisited and the role
  given scoped read + lock on *its own* state.
- **The pre-existing `ai-trader-web-gha-deploy` (PowerUser) role trusted
  `repo:Atom-oh/ai-trader-web:*` — a wildcard including `pull_request`.** That defeated the
  split's premise: attacker-controlled PR plan code could assume *that* role for PowerUser
  instead. It is created out-of-band (not in this repo's nor ai-trader-web's Terraform), so this
  PR **adopts it via `terraform import`** and tightens its trust to `ref:refs/heads/main` **only**
  (NOT `pull_request`) — so PR-plan code can no longer reach PowerUser through it; it can only
  reach the read-only plan role. PowerUser attachment + inline IAM policy preserved. Kept (not
  deleted) because ai-trader-web's `terraform.yml` still uses it until it migrates to the
  plan/admin pair (its PR plan job moves to the read-only plan role then); retire once migrated.

---

<a id="korean"></a>

# 한국어

## 상태

승인됨 (2026-07-12). 기존 `demo-platform-gha-ecr-push`(`infra/iam/gha-ecr-push-role.tf`)의
OIDC 최소권한 관례를, 외부 repo `Atom-oh/ai-trader-web`의 `terraform.yml`이라는 더 높은 권한이
필요한 cross-repo 사례로 확장한다.

## Context

`ai-trader-web`는 자체 `terraform.yml`(PR/push 시 plan, `main` push·`workflow_dispatch` 시
apply, apply job은 GitHub `environment: prod`에 바인딩)을 운영한다. IAM·ECS·CloudFront·
Cognito·NLB·Lambda@Edge·AgentCore를 관리하므로 apply에는 사실상 계정 admin 권한이 필요하다.
기존 `ai-trader-web-gha-deploy`(`PowerUserAccess`)는 IAM을 관리할 수 없어, **admin** 역할이
요청되었다.

단순 설계 — trust에 세 sub(`pull_request`, `ref:refs/heads/main`, `environment:prod`)를 모두
나열한 단일 `AdministratorAccess` 역할 — 에는 PR 리뷰 패널(5/5 모델, PR #69)이 독립적으로
지적한 치명적 결함이 있다:

**`terraform plan`은 PR 브랜치의 코드를 실행한다.** provider 플러그인, `external` data source,
`data` 조회가 모두 plan 중 실행된다. `pull_request` sub가 admin 역할을 assume할 수 있으면,
ai-trader-web에 *PR을 열 수 있는 누구나*(협업자, 또는 plan 단계가 해석하는 CI 의존성을 침해한
공격자)가 계정 admin 자격으로 임의 코드를 실행하게 되어, 권한 작업 전 사람의 리뷰를 요구하는
`environment: prod` 승인 게이트를 완전히 우회한다. trust를 "정확한 sub"로 고정하는 것은 *누가*
assume하는지는 막지만 *어떤 코드가* 실행되는지는 막지 못한다.

이 계정은 demo-platform 전체(EKS hub, Atlantis, Terraform state bucket)를 호스팅하므로,
admin assume 경로가 침해되면 blast radius가 플랫폼 전체다.

## Decision

두 역할로 분리한다(`infra/iam/ai-trader-web-gha-roles.tf`):

| 역할 | Managed policy | 신뢰 (`sub`) | 사용처 |
|------|----------------|-------------|--------|
| `ai-trader-web-terraform-plan` | `ReadOnlyAccess` **+ demo-platform 데이터 inline Deny** | `pull_request`, `ref:refs/heads/main` | plan job |
| `ai-trader-web-terraform-admin` | `AdministratorAccess` | `ref:refs/heads/main` 단독 (IAM 강제 branch 게이트) | apply job |

- 공격자 영향권인 plan job은 읽기만 가능하며, ai-trader-web는 **로컬** state를 쓰므로 *자체*
  state용 권한이 불필요.
- **그러나 `ReadOnlyAccess`는 계정 전역 `s3:Get*`/`dynamodb:Scan`을 부여**하며, 이 계정은
  *플랫폼 전체* 공유 state(버킷 `multi-region-mall-terraform-state` + lock 테이블, 평문 시크릿
  포함 가능)와 demo-platform Lifecycle Controller DynamoDB 테이블을 호스팅한다. plan 역할은
  공격자 통제 PR 브랜치 코드로 assume되므로 "읽기 전용" 자체가 안전하지 않다 — demo-platform
  데이터 exfiltration 경로가 된다. state 버킷/lock 테이블 + `demo-platform-*` DynamoDB 와일드카드
  (IAM 리소스 와일드카드 `*`는 `/`도 매치하므로 `table/demo-platform-*`가 `dynamodb:Query`가
  인가하는 `.../index/*` GSI ARN까지 이미 포함 — 별도 `/index/*` 라인은 방어적 중복) +
  `/demo-platform/*` CloudWatch Logs(`logs:*` — `GetLogEvents`뿐 아니라 log-group 스코프 읽기
  진입점인 `StartQuery`+`StartLiveTail`까지 차단) + `demo-platform-*` SQS(job 큐 + DLQ)에
  **inline Deny** + `demo-platform/*`·`actions-runner-claude` ECR 이미지 Deny(pull한 레이어에
  소스/설정이 baked될 수 있음) + admin Cognito user pool read Deny로 demo-platform의 민감
  스토어를 차단하되, ai-trader-web 자체 리소스(같은 계정에 `ai-trader-*` 이름으로 배포)는 plan
  refresh용으로 읽기 가능하게 남긴다. 이는 **demo-platform 민감 스토어에 대한 표적 denylist이지
  전면 차단이 아니다** — `ReadOnlyAccess`는 계정 전역 `Describe`/`List` 메타데이터를 여전히 부여하며,
  목표는 모든 read가 아니라 시크릿/페이로드를 담은 스토어의 차단이다. permissions-boundary /
  scoped-allowlist 재작성이 더 견고하며 future work로 기록. **시크릿 VALUE**: `ReadOnlyAccess`(v187)에는
  `secretsmanager:GetSecretValue`가 없다(`Describe*`/`List*`/`GetResourcePolicy`만) — operator/
  terraformer ExternalId·GitHub PAT·ArgoCD 토큰·cognito·AI panel key는 이미 읽을 수 없으며,
  `/demo-platform/*`에 명시적 `GetSecretValue` Deny를 부착해 향후 AWS 관리형 정책 변경이 조용히
  경로를 열지 못하게 고정한다. (state 버킷+lock 테이블은 `backend.tf` 기준 `us-east-1`에 있어 lock
  테이블 Deny ARN은 `local.region`이 아닌 `us-east-1`.)
- **admin 역할은 `environment:prod` sub가 아니라 `ref:refs/heads/main` sub로 게이트한다.**
  environment sub는 branch 게이트를 GitHub environment protection에 위임하는데, 이 repo의 billing
  plan은 그것을 강제할 수 없다(private repo에 required-reviewer/branch 제한 rule 미지원:
  `gh api .../environments/prod` → `protection_rules: []`, `PUT` → HTTP 422). `ref:refs/heads/main`은
  **sub**의 일부(실제 IAM condition key — AWS STS가 노출하지 않는 `ref` *claim*과 다름; 그래서
  `gha-ecr-push-role.tf`도 ref를 sub 안에 넣는다)이므로, IAM 자체가 admin을 `main`의 코드로만
  제한한다 — GitHub environment 기능에 의존하지 않는다. (main이 리뷰 게이트라는 것이 의도이나
  여기선 강제 불가 — Consequences의 수용된 트레이드오프 참조.) 따라서 ai-trader-web apply job은
  main push/`workflow_dispatch`에서
  `environment:` 바인딩 **없이** 돌아야 한다(바인딩하면 sub가 `environment:prod`로 바뀌어 이 trust가
  깨진다).
- 장시간 apply 만료 방지를 위해 admin 역할에 `max_session_duration = 7200`.
- 두 역할 모두 공유 `data.aws_iam_openid_connect_provider.github`를 재사용.
- `ai-trader-web-*` prefix 유지(`demo-platform-*`에서의 의도적 이탈) — 기존 out-of-band
  `ai-trader-web-gha-deploy` 역할과 짝을 이룸.

### 신뢰 / 권한 분리

```mermaid
flowchart TD
    subgraph gh["Atom-oh/ai-trader-web · terraform.yml"]
        pr["plan job<br/>sub: pull_request<br/>+ ref:refs/heads/main"]
        ap["apply job<br/>sub: ref:refs/heads/main<br/>(main push/dispatch, environment 없음)"]
    end
    oidc["token.actions.githubusercontent.com<br/>(공유 OIDC provider)"]
    plan["ai-trader-web-terraform-plan<br/>ReadOnlyAccess + demo-platform 데이터 Deny"]
    admin["ai-trader-web-terraform-admin<br/>AdministratorAccess · 2h 세션"]
    pr -->|OIDC AssumeRoleWithWebIdentity| oidc
    ap -->|OIDC AssumeRoleWithWebIdentity| oidc
    oidc -->|sub 일치| plan
    oidc -->|sub 일치: main 한정| admin
    pr -.->|"공격자 통제 plan 코드<br/>→ 읽기 전용, demo-platform 데이터 차단"| plan
    ap -.->|"main 코드(push-gated,<br/>트레이드오프 참조)→ admin"| admin
```

## Consequences

- 공격자가 통제하는 plan 코드는 읽기 전용으로 한정되고 demo-platform state/데이터를 읽을 수
  없다 — PR 트리거로 분리를 우회할 수 없다.
- admin 게이트는 **IAM 계층**(`ref:refs/heads/main` sub)에서 강제되므로 GitHub environment
  protection(이 repo 플랜이 제공 불가)에 의존하지 않는다. `main`의 코드만 admin을 assume할 수
  있다. (이전 리비전은 `environment:prod`로 게이트했으나 강제 가능한 environment protection이
  없어 폐기 — 위 trust 불릿 참조.)
- **수용된 트레이드오프(2026-07-13): 이 repo는 main branch protection도 강제 불가.**
  ai-trader-web는 environment protection도 branch protection/ruleset도 지원하지 않는 플랜의
  private repo다(`gh api .../branches/main/protection` → HTTP 403 "Upgrade to GitHub Pro or
  make this repository public"). 따라서 "main에 병합된 리뷰된 코드만"이라는 게이트는 강제되지
  않는 목표일 뿐 — **main에 push 가능한 사람(collaborator 또는 탈취된 자격증명)은 리뷰 없이 이
  계정의 `AdministratorAccess`를 획득**하며, 이 계정은 플랫폼 전체(EKS hub·Atlantis·공유 tfstate)를
  호스팅한다. 현재 수용하는 이유: (a) plan/apply 분리로 임의-PR 경로는 이미 닫힘(비신뢰 `plan`은
  read-only + demo-platform 데이터 Deny), (b) 잔여 경로는 main-push 권한을 전제, (c) non-production
  계정. 실제 차단하려면 플랜 업그레이드(또는 repo 공개) 후 `main`에 required-review branch/ruleset을
  설정하면 이 불릿을 폐기 가능. 그 전까지 admin은 ai-trader-web collaborator 목록만이 게이트.
- 후속(ai-trader-web PR): `terraform.yml` plan job → `role-to-assume:
  arn:aws:iam::180294183052:role/ai-trader-web-terraform-plan`, apply job →
  `arn:aws:iam::180294183052:role/ai-trader-web-terraform-admin` (ARN은
  `ai_trader_web_terraform_{plan,admin}_role_arn` output으로 export). 두 job 모두
  `permissions: id-token: write` 필요. apply job은 main push/`workflow_dispatch`에서
  `environment:` 키 **없이** 돌아야 한다(environment 바인딩 시 OIDC sub가 `environment:prod`로
  바뀌어 `ref:refs/heads/main` sub에 고정된 admin trust가 거부한다). 또한 2h 세션 적용을 위해
  `configure-aws-credentials`에 `role-duration-seconds: 7200`도 설정해야 한다(미설정 시 기본 1h).
- ai-trader-web는 ephemeral 러너에서 로컬 state를 쓴다(매 실행 소실). 이후 remote backend를
  도입하면 plan 역할의 공유-state Deny를 재검토하고 *자체* state에 대한 read + lock 권한을
  부여해야 한다.
- **기존 `ai-trader-web-gha-deploy`(PowerUser) 역할은 `repo:Atom-oh/ai-trader-web:*`를 신뢰했다 —
  `pull_request`를 포함하는 와일드카드.** 이것이 분리의 전제를 무너뜨렸다: 공격자 통제 PR plan
  코드가 *그 역할*을 assume해 PowerUser를 얻을 수 있었다. out-of-band 생성(이 repo·ai-trader-web
  Terraform 어디에도 없음)이라 이 PR이 **`terraform import`로 편입**하고 trust를
  `ref:refs/heads/main` **단독**(`pull_request` 제외)으로 축소 — PR-plan 코드는 더 이상 이 역할로
  PowerUser에 도달할 수 없고 read-only plan 역할만 assume 가능. PowerUser attachment + inline IAM
  정책은 보존. ai-trader-web `terraform.yml`이 아직 사용 중이라 삭제하지 않고 유지(그 PR plan job은
  이 migration에서 read-only plan 역할로 전환) — 새 역할 쌍 이전 후 폐기.
