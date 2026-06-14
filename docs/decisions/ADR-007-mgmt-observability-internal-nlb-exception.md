# ADR-007: Internal NLB exception for mgmt observability fan-in

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## Status
Accepted (2026-06-14)

## Context
The demo platform's ingress convention is CloudFront → VPC Origin → Internal ALB → TargetGroupBinding, with **no NLB and no Kubernetes Ingress** (see CLAUDE.md, ADR-004).

However, the hub cluster (`mall-apne2-mgmt`) hosts the observability backends (Grafana Tempo, ClickHouse, Prometheus) that the spoke clusters (`mall-apne2-az-a`, `mall-apne2-az-c`) push into: spoke OTel Collectors send traces/logs to ClickHouse (native TCP :9000) and Tempo (OTLP gRPC :4317), and workload Prometheus agents remote-write to the hub Prometheus (:9090). This is an **L4 cross-cluster fan-in**, not L7 HTTP request ingress. ClickHouse's native TCP protocol in particular cannot be terminated by an L7 ALB.

The EKS clusters are **reused** from `multi-region-architecture` — the three internal NLBs (`clickhouse-nlb`, `tempo-nlb`, `prometheus-nlb`, all `scheme=internal`, restricted to SG `sg-0613a5ecf8009daff`) already exist and carry live traffic. ArgoCD syncs these targets with `prune: true`, so dropping them from the migrated target set would **delete the live NLBs** and break the observability pipeline.

## Options Considered

### Option 1: Keep the internal NLBs as an explicit exception (chosen)
- **Pros**: No disruption to the live spoke→hub fan-in; faithful GitOps ownership handoff (no pruning of live resources); ClickHouse native TCP works; matches existing infra.
- **Cons**: Introduces a documented NLB exception to the otherwise NLB-free convention (scoped to internal data-plane only).

### Option 2: Replace the NLBs with TargetGroupBinding → internal ALB
- **Pros**: Conforms to the platform's ALB/TGB convention.
- **Cons**: L7 ALB cannot terminate ClickHouse native TCP (:9000); OTLP gRPC and Prometheus remote-write are also better served by L4. Would require re-architecting the spoke exporters and risks breaking the live pipeline. Not viable for the TCP backend.

### Option 3: In-cluster ClusterIP only — drop cross-cluster collection
- **Pros**: Zero NLB; fully convention-compliant.
- **Cons**: Spoke clusters could no longer ship telemetry to the hub backends, gutting centralized observability. Rejected — defeats the purpose of the shared hub.

## Decision
Keep the three internal NLBs in `k8s/system/clickhouse-mgmt/internal-nlb-services.yaml` as an **explicit, scoped exception** to the no-NLB convention. The exception is limited to internal (`scheme=internal`), SG-restricted (`sg-0613a5ecf8009daff`) data-plane fan-in for observability. The platform's bans on **public** load balancers and on Kubernetes Ingress remain fully in force; external/admin ingress continues to use CloudFront → ALB → TGB.

## Consequences

### Positive
- Live spoke→hub observability fan-in continues uninterrupted through the ArgoCD ownership handoff.
- Faithful GitOps replication — no live resource is pruned when this repo takes over the hub root-app.

### Negative
- A data-plane-only NLB exception now exists alongside the no-NLB convention; future readers must consult this ADR. If the topology later collapses to a single cluster, this can be reclaimed with in-cluster ClusterIP. See [[non-production-tolerance]].

## References
- `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md`
- `docs/superpowers/specs/2026-06-14-mgmt-cluster-argocd-target-handoff-design.md`
- ADR-004 (same-origin CloudFront), CLAUDE.md (CloudFront-only ingress convention)
- `k8s/system/clickhouse-mgmt/internal-nlb-services.yaml`, `argocd-apps/system/appset-clickhouse.yaml`, `argocd-apps/system/appset-tempo.yaml`

---

<a id="korean"></a>

# 한국어

## 상태
승인됨 (2026-06-14)

## 배경
데모 플랫폼의 ingress 규약은 CloudFront → VPC Origin → Internal ALB → TargetGroupBinding이며 **NLB와 Kubernetes Ingress를 사용하지 않는다**(CLAUDE.md, ADR-004 참고).

그러나 hub 클러스터(`mall-apne2-mgmt`)는 spoke 클러스터(`mall-apne2-az-a`, `mall-apne2-az-c`)가 push하는 관측 백엔드(Grafana Tempo, ClickHouse, Prometheus)를 호스팅한다. spoke OTel Collector는 ClickHouse(native TCP :9000)와 Tempo(OTLP gRPC :4317)로 trace/log를 보내고, workload Prometheus는 hub Prometheus(:9090)로 remote-write 한다. 이는 L7 HTTP 요청 ingress가 아니라 **L4 클러스터 간 fan-in**이다. 특히 ClickHouse native TCP는 L7 ALB로 종단할 수 없다.

EKS 클러스터는 `multi-region-architecture`와 **재사용**된다 — internal NLB 3개(`clickhouse-nlb`, `tempo-nlb`, `prometheus-nlb`, 전부 `scheme=internal`, SG `sg-0613a5ecf8009daff`로 제한)는 이미 존재하며 live 트래픽을 처리한다. ArgoCD는 이 타깃을 `prune: true`로 동기화하므로, 마이그레이션 타깃에서 빼면 **live NLB가 삭제**되어 관측 파이프라인이 끊긴다.

## 검토한 옵션

### 옵션 1: internal NLB를 명시적 예외로 유지 (채택)
- **장점**: live spoke→hub fan-in 무중단; 충실한 GitOps 소유권 이전(live 리소스 prune 없음); ClickHouse native TCP 동작; 기존 인프라와 일치.
- **단점**: NLB-free 규약에 문서화된 예외가 생김(내부 데이터플레인으로 한정).

### 옵션 2: NLB를 TargetGroupBinding → internal ALB로 대체
- **장점**: 플랫폼 ALB/TGB 규약 준수.
- **단점**: L7 ALB는 ClickHouse native TCP(:9000)를 종단 못 함; OTLP gRPC·Prometheus remote-write도 L4가 적합. spoke exporter 재설계 필요 + live 파이프라인 중단 위험. TCP 백엔드엔 비현실적.

### 옵션 3: in-cluster ClusterIP만 사용 — 클러스터 간 수집 포기
- **장점**: NLB 전무; 규약 완전 준수.
- **단점**: spoke가 hub 백엔드로 텔레메트리를 보낼 수 없어 중앙 관측이 무력화됨. 공유 hub의 목적에 반하므로 기각.

## 결정
`k8s/system/clickhouse-mgmt/internal-nlb-services.yaml`의 internal NLB 3개를 no-NLB 규약의 **명시적·한정적 예외**로 유지한다. 예외는 관측용 internal(`scheme=internal`)·SG 제한(`sg-0613a5ecf8009daff`) 데이터플레인 fan-in에 국한된다. **public** 로드밸런서 금지와 Kubernetes Ingress 금지는 그대로 유효하며, 외부/관리자 ingress는 CloudFront → ALB → TGB를 계속 사용한다.

## 영향

### 긍정적
- ArgoCD 소유권 이전 중에도 live spoke→hub 관측 fan-in이 끊기지 않는다.
- 충실한 GitOps 복제 — 이 repo가 hub root-app을 인수할 때 live 리소스가 prune되지 않는다.

### 부정적
- no-NLB 규약과 함께 데이터플레인 한정 NLB 예외가 존재하게 된다; 향후 독자는 이 ADR을 참조해야 한다. 추후 단일 클러스터로 통합되면 in-cluster ClusterIP로 회수 가능. [[non-production-tolerance]] 참고.

## 참고 자료
- `docs/superpowers/specs/2026-05-26-aws-demo-platform-design.md`
- `docs/superpowers/specs/2026-06-14-mgmt-cluster-argocd-target-handoff-design.md`
- ADR-004 (same-origin CloudFront), CLAUDE.md (CloudFront-only ingress 규약)
- `k8s/system/clickhouse-mgmt/internal-nlb-services.yaml`, `argocd-apps/system/appset-clickhouse.yaml`, `argocd-apps/system/appset-tempo.yaml`
