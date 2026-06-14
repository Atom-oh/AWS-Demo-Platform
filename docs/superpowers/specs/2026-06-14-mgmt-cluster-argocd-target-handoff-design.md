# mgmt 클러스터 ArgoCD 타깃 핸드오프 (tempo + clickhouse)

- **Date**: 2026-06-14
- **Status**: Approved (design)
- **Scope**: `k8s/system/`, `argocd-apps/system/`, `docs/decisions/ADR-007`

## 1. 배경과 명제

이 작업은 인프라 재구축이 아니다. hub EKS 클러스터(`mall-apne2-mgmt`)와 spoke 클러스터(`mall-apne2-az-{a,c}`)는 `multi-region-architecture`와 **물리적으로 동일한 클러스터를 재사용**한다. 따라서 마이그레이션의 본질은 **ArgoCD App-of-Apps(root-app)의 동기화 타깃 소유권을 `multi-region-architecture` 리포에서 `AWS-Demo-Platform` 리포로 이전**하는 것이다.

소스 hub root-app(`k8s/infra/argocd-korea/apps/`, kustomization 기준 39개 타깃)이 동기화하는 타깃 중, 이 리포의 `master-system-root`(`argocd-apps/system`, directory recursion)에 **아직 존재하지 않는 타깃만** 복제하면 핸드오프가 완성된다.

## 2. 갭 분석 결과

소스 39개 타깃을 dest와 1:1 대조한 결과:

| 분류 | 소스 타깃 | dest 상태 |
| --- | --- | --- |
| 시스템/인프라 (helm 인라인) | otel-collector, prometheus-mgmt/workload, clickhouse-operator, alb-controller, karpenter, external-secrets, ARC, 러너 다수, storageclass, grafana-dashboards, infra, runner-scheduler | ✅ 전부 존재 (대부분 upstream chart + 인라인 `valuesObject`) |
| **시스템 (path 기반)** | **appset-tempo**, **appset-clickhouse** | ❌ **빠짐 — 이번 작업 대상** |
| mall 워크로드 (tenant) | appset-core/user/fulfillment/business/platform | ⏭️ 대상 아님. dest `tenants/`(`multi-region-mall-az-{a,c}.yaml`)가 소스 overlays(`k8s/overlays/...`)를 App-of-Apps로 이미 커버 |

즉 시스템 계층에서 **유일하게 빠진 타깃은 `appset-tempo` + `appset-clickhouse` 2개**다. 둘 다 path 기반(소스 리포의 리포 소유 manifest를 가리킴)이며 `mall-apne2-mgmt` 단일 셀렉터다.

## 3. 결정 사항

| 결정 | 선택 | 근거 |
| --- | --- | --- |
| 충돌 처리 | 목적지(데모 플랫폼) 우선 (적응 복사) | 기존 dest 컴포넌트(ArgoCD 9.5.15, ESO v1, TGB ingress)는 유지 |
| 소유권 이전 정도 | **이 repo로 완전 이전** | manifest를 `k8s/system/`으로 복사, appset path/repoURL을 이 repo로 재포인팅. 소스 repo 폐기 가능 |
| `internal-nlb-services.yaml` | **그대로 유지 (충실 복제)** | live 클러스터에 이미 존재하며 spoke otel-collector가 push하는 데이터플레인. `prune: true`이므로 빼면 실서비스 NLB 삭제 → ADR-007로 예외 기록 |

## 4. 구현 변경 (총 7개 파일)

### A. 리포 소유 manifest 복제 (소스 → 이 repo, 내용 충실 복제)
- `k8s/system/tempo/`
  - `namespace.yaml`, `tempo.yaml`, `kustomization.yaml` ← 소스 `k8s/infra/tempo/`
- `k8s/system/clickhouse-mgmt/` (`.keep` 삭제)
  - `clickhouse-installation.yaml`, `internal-nlb-services.yaml`, `kustomization.yaml` ← 소스 `k8s/infra/clickhouse-mgmt/`

### B. ArgoCD 타깃 appset 생성 (소스에서 복사 후 repoURL/path만 재포인팅)
- `argocd-apps/system/appset-tempo.yaml`
  - `repoURL: https://github.com/Atom-oh/AWS-Demo-Platform`, `targetRevision: main`, `path: k8s/system/tempo`
  - 그대로 유지: `mall-apne2-mgmt` 셀렉터, kustomize 패치(SA IRSA role, ConfigMap S3 버킷/region, Deployment tolerations `workload-type=platform`/`nodeSelector node-pool=platform`), `namespace: observability`, `Replace=true`
- `argocd-apps/system/appset-clickhouse.yaml`
  - `repoURL: https://github.com/Atom-oh/AWS-Demo-Platform`, `path: k8s/system/clickhouse-mgmt`
  - 그대로 유지: `mall-apne2-mgmt` 셀렉터, `namespace: observability`

### C. ADR
- `docs/decisions/ADR-007-mgmt-observability-internal-nlb-exception.md` — clickhouse/tempo/prometheus internal NLB를 "no-NLB" 규약의 명시적 예외로 기록(데이터플레인 fan-in, 클러스터 재사용, prune 안전성).

## 5. 충실 복제 원칙 (값 변경 금지 항목)
재사용하는 AWS 리소스/live 리소스라 다음은 소스 값 그대로 유지한다.
- tempo IRSA role ARN: `arn:aws:iam::180294183052:role/production-tempo-ap-northeast-2-mgmt`
- tempo S3 버킷: `production-mall-tempo-traces-ap-northeast-2-mgmt`
- `internal-nlb-services.yaml`의 NLB 정의 3개
- ESO 버전 충돌 없음 — tempo/clickhouse 둘 다 ESO 미사용

## 6. 핸드오프 시퀀싱 (운영)
소스 root-app과 이 repo `master-system-root`가 동시에 활성이면 동일 이름 Application(`tempo-mall-apne2-mgmt`, `clickhouse-mall-apne2-mgmt`)을 두고 충돌한다. 적용 순서:
1. 이 repo PR 머지 (manifest + appset)
2. 소스 hub root-app(`argocd-korea/apps/kustomization.yaml`)에서 `appset-tempo.yaml`/`appset-clickhouse.yaml` 제거 — 또는 소스 root-app 전체 폐기
3. ArgoCD가 이 repo 타깃으로 재조정. **live apply는 사용자 게이트** (Atlantis/ArgoCD)

## 7. 검증
- `kubectl kustomize k8s/system/tempo` → `kubectl apply --dry-run=client -f -`
- `kubectl kustomize k8s/system/clickhouse-mgmt` → `kubectl apply --dry-run=client -f -`
- `kubectl apply --dry-run=client -f argocd-apps/system/appset-tempo.yaml` (및 clickhouse)
- `bash tests/run-all.sh`
- 머지 후 ArgoCD에서 `tempo-mall-apne2-mgmt`, `clickhouse-mall-apne2-mgmt` Application이 Healthy/Synced인지 확인 (apply는 사용자 게이트)

## 8. 비범위 (명시적 제외)
- mall 워크로드 appset(core/user/fulfillment/business/platform) — tenant 계층, dest `tenants/`가 이미 커버
- `tempo-west`(us-west NLB), 비-mgmt `clickhouse`, `keda/scaledobjects`(MSK), `fluent-bit`, `external-secrets/secrets/*`(mall/* 키), `prometheus-stack/alerting-rules.yaml`(소스 root-app 미동기화) — 모두 소스 hub root-app 타깃이 아니거나 mall 전용
- obsolete placeholder 정리(`argocd-cm-patch` 등)는 별도 작업
