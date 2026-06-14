# mgmt 클러스터 ArgoCD 타깃 핸드오프 (tempo + clickhouse) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소스 hub ArgoCD root-app이 동기화하지만 이 repo `master-system-root`에 빠진 두 타깃(`appset-tempo`, `appset-clickhouse`)을 이 repo로 완전 이전하여, 이 repo가 hub GitOps의 단독 source of truth가 되게 한다.

**Architecture:** EKS 클러스터(hub `mall-apne2-mgmt`)는 `multi-region-architecture`와 동일 클러스터를 재사용한다. 따라서 인프라 재구축이 아니라 **ArgoCD 동기화 타깃 소유권 이전**이다. 리포 소유 manifest(`k8s/system/tempo`, `k8s/system/clickhouse-mgmt`)를 복제하고, 이를 가리키는 ApplicationSet 2개를 `argocd-apps/system/`에 추가한다. 클러스터·AWS 리소스가 재사용되고 ArgoCD `prune: true`이므로, 타깃 집합은 소스와 **충실히 복제**하여 live 리소스가 prune되지 않게 한다(internal NLB 포함).

**Tech Stack:** Kustomize, ArgoCD ApplicationSet (cluster generator), Grafana Tempo 2.7.2, Altinity ClickHouse Operator(기존) + ClickHouseInstallation CR, AWS S3/IRSA(기존 `infra/eks-mgmt` `tempo_storage` 모듈이 `production-mall-tempo-traces-ap-northeast-2-mgmt` 버킷 + `production-tempo-ap-northeast-2-mgmt` role 생성).

**검증 도구:** 단위 테스트 프레임워크가 없는 인프라 매니페스트 작업이므로, 각 태스크의 "실패하는 테스트"는 **렌더 검증 게이트**다 — `kubectl kustomize <dir>`(빌드 성공) + `kubectl apply --dry-run=client`(스키마/구문). ApplicationSet/CRD 종류는 `--validate=false`로 클라이언트 검증을 건너뛴다. 최종 게이트는 `bash tests/run-all.sh`(현재 47/47 통과).

**핵심 사전 사실:**
- 이 repo `infra/eks-mgmt`(main)가 tempo S3 버킷/IRSA role을 소스 appset 값과 **정확히 같은 이름**으로 생성(`environment=production`, `region=ap-northeast-2`, `name_suffix=-mgmt`). 신규 Terraform 불필요.
- 소스 `appset-tempo`의 kustomize 패치 중 ConfigMap `tempo-config` `/data/TEMPO_S3_BUCKET`·`/data/AWS_REGION` replace는 **해당 키가 존재하지 않아** kustomize build를 깨뜨린다. tempo는 `-config.expand-env=true` + 컨테이너 env(Deployment 패치가 주입)로 `${TEMPO_S3_BUCKET}`/`${AWS_REGION}`를 해석하므로, 이 깨진 ConfigMap 패치는 **의도적으로 드롭**한다(이 repo가 manifest를 소유하므로 정당한 적응; 동작 동일).
- `clickhouse-installation.yaml`의 `default/networks/ip: 0.0.0.0/0`은 SG 인그레스가 아니라 **ClickHouse 유저 네트워크 ACL**(internal-only NLB 뒤, in-cluster)이며 기존 live 설정의 충실 복제다 — 보안 게이트 false-positive 아님.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `k8s/system/tempo/namespace.yaml` | `observability` 네임스페이스 |
| `k8s/system/tempo/tempo.yaml` | Tempo ConfigMap/SA/Deployment/Service/ServiceMonitor (단일 바이너리, S3 백엔드) |
| `k8s/system/tempo/kustomization.yaml` | 위 두 리소스 묶음 |
| `k8s/system/clickhouse-mgmt/clickhouse-installation.yaml` | ClickHouseInstallation CR(otel 스키마, gp3 100Gi, platform 톨러레이션) |
| `k8s/system/clickhouse-mgmt/internal-nlb-services.yaml` | clickhouse/tempo/prometheus internal NLB 3개(spoke→hub fan-in) |
| `k8s/system/clickhouse-mgmt/kustomization.yaml` | 위 두 리소스 묶음 (`.keep` 대체) |
| `argocd-apps/system/appset-tempo.yaml` | mgmt 셀렉터 ApplicationSet → 이 repo `k8s/system/tempo` |
| `argocd-apps/system/appset-clickhouse.yaml` | mgmt 셀렉터 ApplicationSet → 이 repo `k8s/system/clickhouse-mgmt` |
| `docs/decisions/ADR-007-mgmt-observability-internal-nlb-exception.md` | internal NLB를 "no-NLB" 규약의 명시적 예외로 기록 |
| `k8s/CLAUDE.md` (modify) | Key Directories에 tempo/clickhouse-mgmt 추가 |
| `docs/architecture.md` (modify) | GitOps/관측 섹션에 tempo/clickhouse 타깃 반영 |

---

## Task 1: Tempo 베이스 매니페스트 복제

**Files:**
- Create: `k8s/system/tempo/namespace.yaml`
- Create: `k8s/system/tempo/tempo.yaml`
- Create: `k8s/system/tempo/kustomization.yaml`

- [ ] **Step 1: 검증 게이트(실패 확인) — 디렉토리 부재**

Run: `kubectl kustomize k8s/system/tempo`
Expected: FAIL — `no such file or directory` (아직 생성 전)

- [ ] **Step 2: `k8s/system/tempo/namespace.yaml` 작성**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: observability
  labels:
    name: observability
```

- [ ] **Step 3: `k8s/system/tempo/tempo.yaml` 작성** (소스 `k8s/infra/tempo/tempo.yaml` 충실 복제)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: tempo-config
  namespace: observability
  labels:
    app: tempo
data:
  tempo.yaml: |
    stream_over_http_enabled: true
    server:
      http_listen_port: 3200
      grpc_listen_port: 9095

    distributor:
      receivers:
        otlp:
          protocols:
            grpc:
              endpoint: 0.0.0.0:4317
            http:
              endpoint: 0.0.0.0:4318

    ingester:
      max_block_duration: 5m

    compactor:
      compaction:
        block_retention: 720h    # 30 days

    metrics_generator:
      registry:
        external_labels:
          source: tempo
          cluster: mall-cluster
      storage:
        path: /var/tempo/generator/wal
        remote_write:
          - url: http://k8s-monitori-promethe-0fad301b35-bd8824e1caa3e556.elb.ap-northeast-2.amazonaws.com:9090/api/v1/write
            send_exemplars: true

    storage:
      trace:
        backend: s3
        s3:
          bucket: ${TEMPO_S3_BUCKET}
          endpoint: s3.dualstack.${AWS_REGION}.amazonaws.com
          region: ${AWS_REGION}
          # IRSA provides credentials automatically
        wal:
          path: /var/tempo/wal
        local:
          path: /var/tempo/blocks

    overrides:
      defaults:
        metrics_generator:
          processors:
            - service-graphs
            - span-metrics
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: tempo
  namespace: observability
  annotations:
    eks.amazonaws.com/role-arn: "arn:aws:iam::180294183052:role/production-tempo-ap-northeast-2-mgmt"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tempo
  namespace: observability
  labels:
    app: tempo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: tempo
  template:
    metadata:
      labels:
        app: tempo
    spec:
      serviceAccountName: tempo
      tolerations:
        - key: node-role
          value: system-critical
          effect: NoSchedule
      nodeSelector:
        role: system
      containers:
        - name: tempo
          image: grafana/tempo:2.7.2
          args:
            - -config.file=/etc/tempo/tempo.yaml
            - -config.expand-env=true
          ports:
            - name: http
              containerPort: 3200
              protocol: TCP
            - name: grpc
              containerPort: 9095
              protocol: TCP
            - name: otlp-grpc
              containerPort: 4317
              protocol: TCP
            - name: otlp-http
              containerPort: 4318
              protocol: TCP
          env:
            - name: AWS_REGION
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['region.kubernetes.io/name']
            - name: TEMPO_S3_BUCKET
              valueFrom:
                configMapKeyRef:
                  name: tempo-region-config
                  key: TEMPO_S3_BUCKET
                  optional: true
          envFrom:
            - configMapRef:
                name: region-config
                optional: true
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: "1"
              memory: 2Gi
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 15
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 30
            periodSeconds: 15
          volumeMounts:
            - name: config
              mountPath: /etc/tempo
              readOnly: true
            - name: tempo-data
              mountPath: /var/tempo
      volumes:
        - name: config
          configMap:
            name: tempo-config
        - name: tempo-data
          emptyDir:
            sizeLimit: 10Gi
---
apiVersion: v1
kind: Service
metadata:
  name: tempo
  namespace: observability
  labels:
    app: tempo
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 3200
      targetPort: http
      protocol: TCP
    - name: grpc
      port: 9095
      targetPort: grpc
      protocol: TCP
    - name: otlp-grpc
      port: 4317
      targetPort: otlp-grpc
      protocol: TCP
    - name: otlp-http
      port: 4318
      targetPort: otlp-http
      protocol: TCP
  selector:
    app: tempo
---
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: tempo
  namespace: observability
  labels:
    app: tempo
spec:
  selector:
    matchLabels:
      app: tempo
  endpoints:
    - port: http
      interval: 30s
      path: /metrics
```

- [ ] **Step 4: `k8s/system/tempo/kustomization.yaml` 작성**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - namespace.yaml
  - tempo.yaml
```

- [ ] **Step 5: 검증 게이트(통과 확인)**

Run: `kubectl kustomize k8s/system/tempo | kubectl apply --dry-run=client --validate=false -f -`
Expected: PASS — `namespace/observability created (dry run)`, `configmap/tempo-config ...`, `serviceaccount/tempo ...`, `deployment.apps/tempo ...`, `service/tempo ...` (ServiceMonitor는 CRD 미존재 시 `--validate=false`로 통과). 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add k8s/system/tempo/
git commit -m "feat(k8s/tempo): migrate Tempo manifest to demo platform repo

Faithful copy of multi-region-architecture k8s/infra/tempo. Cluster is
reused; S3 bucket production-mall-tempo-traces-ap-northeast-2-mgmt and
IRSA role production-tempo-ap-northeast-2-mgmt are provisioned by this
repo's infra/eks-mgmt tempo_storage module."
```

---

## Task 2: ClickHouse(mgmt) 베이스 매니페스트 복제

**Files:**
- Delete: `k8s/system/clickhouse-mgmt/.keep`
- Create: `k8s/system/clickhouse-mgmt/clickhouse-installation.yaml`
- Create: `k8s/system/clickhouse-mgmt/internal-nlb-services.yaml`
- Create: `k8s/system/clickhouse-mgmt/kustomization.yaml`

- [ ] **Step 1: 검증 게이트(실패 확인)**

Run: `kubectl kustomize k8s/system/clickhouse-mgmt`
Expected: FAIL — kustomization.yaml 부재(현재 `.keep`만 존재)

- [ ] **Step 2: `.keep` 제거 후 `clickhouse-installation.yaml` 작성** (소스 충실 복제)

```bash
git rm k8s/system/clickhouse-mgmt/.keep
```

`k8s/system/clickhouse-mgmt/clickhouse-installation.yaml`:

```yaml
apiVersion: "clickhouse.altinity.com/v1"
kind: "ClickHouseInstallation"
metadata:
  name: clickhouse
  namespace: observability
spec:
  defaults:
    templates:
      dataVolumeClaimTemplate: data-volume
      serviceTemplate: svc-template
  configuration:
    clusters:
      - name: otel
        layout:
          shardsCount: 1
          replicasCount: 1
        templates:
          podTemplate: clickhouse-pod
    users:
      default/networks/ip:
        - "0.0.0.0/0"
      default/profile: default
      default/quota: default
    profiles:
      default/max_memory_usage: "8000000000"
      default/max_query_size: "1073741824"
    settings:
      format_schema_path: /etc/clickhouse-server/config.d/
    files:
      init_otel_schema.sql: |
        CREATE DATABASE IF NOT EXISTS otel;

        CREATE TABLE IF NOT EXISTS otel.otel_traces (
            Timestamp DateTime64(9) CODEC(Delta, ZSTD(1)),
            TraceId String CODEC(ZSTD(1)),
            SpanId String CODEC(ZSTD(1)),
            ParentSpanId String CODEC(ZSTD(1)),
            TraceState String CODEC(ZSTD(1)),
            SpanName LowCardinality(String) CODEC(ZSTD(1)),
            SpanKind LowCardinality(String) CODEC(ZSTD(1)),
            ServiceName LowCardinality(String) CODEC(ZSTD(1)),
            ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
            ScopeName String CODEC(ZSTD(1)),
            ScopeVersion String CODEC(ZSTD(1)),
            SpanAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
            Duration Int64 CODEC(ZSTD(1)),
            StatusCode LowCardinality(String) CODEC(ZSTD(1)),
            StatusMessage String CODEC(ZSTD(1)),
            Events Nested (
                Timestamp DateTime64(9),
                Name LowCardinality(String),
                Attributes Map(LowCardinality(String), String)
            ) CODEC(ZSTD(1)),
            Links Nested (
                TraceId String,
                SpanId String,
                TraceState String,
                Attributes Map(LowCardinality(String), String)
            ) CODEC(ZSTD(1))
        ) ENGINE = MergeTree()
        PARTITION BY toDate(Timestamp)
        ORDER BY (ServiceName, SpanName, toUnixTimestamp(Timestamp), TraceId)
        TTL toDateTime(Timestamp) + INTERVAL 30 DAY DELETE
        SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

        CREATE TABLE IF NOT EXISTS otel.otel_logs (
            Timestamp DateTime64(9) CODEC(Delta, ZSTD(1)),
            TraceId String CODEC(ZSTD(1)),
            SpanId String CODEC(ZSTD(1)),
            TraceFlags UInt32 CODEC(ZSTD(1)),
            SeverityText LowCardinality(String) CODEC(ZSTD(1)),
            SeverityNumber Int32 CODEC(ZSTD(1)),
            ServiceName LowCardinality(String) CODEC(ZSTD(1)),
            Body String CODEC(ZSTD(1)),
            ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
            ScopeName String CODEC(ZSTD(1)),
            ScopeVersion String CODEC(ZSTD(1)),
            LogAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1))
        ) ENGINE = MergeTree()
        PARTITION BY toDate(Timestamp)
        ORDER BY (ServiceName, SeverityText, toUnixTimestamp(Timestamp), TraceId)
        TTL toDateTime(Timestamp) + INTERVAL 30 DAY DELETE
        SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
  templates:
    podTemplates:
      - name: clickhouse-pod
        spec:
          tolerations:
            - key: workload-type
              value: platform
              effect: NoSchedule
          nodeSelector:
            node-pool: platform
          securityContext:
            runAsUser: 101
            runAsGroup: 101
            fsGroup: 101
          containers:
            - name: clickhouse
              image: clickhouse/clickhouse-server:24.8
              resources:
                requests:
                  cpu: "2"
                  memory: 4Gi
                limits:
                  cpu: "4"
                  memory: 8Gi
              ports:
                - name: http
                  containerPort: 8123
                - name: tcp
                  containerPort: 9000
                - name: interserver
                  containerPort: 9009
    volumeClaimTemplates:
      - name: data-volume
        spec:
          storageClassName: gp3
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: 100Gi
    serviceTemplates:
      - name: svc-template
        generateName: clickhouse-{chi}
        spec:
          ports:
            - name: http
              port: 8123
            - name: tcp
              port: 9000
          type: ClusterIP
```

- [ ] **Step 3: `k8s/system/clickhouse-mgmt/internal-nlb-services.yaml` 작성** (충실 복제 — ADR-007로 예외 기록)

```yaml
---
# Internal NLB for ClickHouse — workload cluster OTel Collectors connect here
apiVersion: v1
kind: Service
metadata:
  name: clickhouse-nlb
  namespace: observability
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "external"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internal"
    service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"
    # SG ID from: terraform output internal_observability_nlb_security_group_id
    service.beta.kubernetes.io/aws-load-balancer-security-groups: "sg-0613a5ecf8009daff"
spec:
  type: LoadBalancer
  ports:
    - name: tcp
      port: 9000
      targetPort: 9000
      protocol: TCP
    - name: http
      port: 8123
      targetPort: 8123
      protocol: TCP
  selector:
    clickhouse.altinity.com/chi: clickhouse
    clickhouse.altinity.com/cluster: otel
---
# Internal NLB for Tempo — workload cluster OTel Collectors connect here
apiVersion: v1
kind: Service
metadata:
  name: tempo-nlb
  namespace: observability
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "external"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internal"
    service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"
    # SG ID from: terraform output internal_observability_nlb_security_group_id
    service.beta.kubernetes.io/aws-load-balancer-security-groups: "sg-0613a5ecf8009daff"
spec:
  type: LoadBalancer
  ports:
    - name: otlp-grpc
      port: 4317
      targetPort: 4317
      protocol: TCP
    - name: http
      port: 3200
      targetPort: 3200
      protocol: TCP
  selector:
    app: tempo
---
# Internal NLB for Prometheus — workload Prometheus agents remote-write here
apiVersion: v1
kind: Service
metadata:
  name: prometheus-nlb
  namespace: monitoring
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "external"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internal"
    service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"
    # SG ID from: terraform output internal_observability_nlb_security_group_id
    service.beta.kubernetes.io/aws-load-balancer-security-groups: "sg-0613a5ecf8009daff"
spec:
  type: LoadBalancer
  ports:
    - name: http
      port: 9090
      targetPort: 9090
      protocol: TCP
  selector:
    app.kubernetes.io/name: prometheus
    operator.prometheus.io/name: prometheus-mall-apne2-mgmt-prometheus
```

- [ ] **Step 4: `k8s/system/clickhouse-mgmt/kustomization.yaml` 작성**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - clickhouse-installation.yaml
  - internal-nlb-services.yaml
```

- [ ] **Step 5: 검증 게이트(통과 확인)**

Run: `kubectl kustomize k8s/system/clickhouse-mgmt | kubectl apply --dry-run=client --validate=false -f -`
Expected: PASS — `clickhouseinstallation.clickhouse.altinity.com/clickhouse created (dry run)`, `service/clickhouse-nlb ...`, `service/tempo-nlb ...`, `service/prometheus-nlb ...`. 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add k8s/system/clickhouse-mgmt/
git commit -m "feat(k8s/clickhouse-mgmt): migrate ClickHouse CHI + internal NLBs

CHI CR (operator already present) + 3 internal NLBs for spoke->hub
observability fan-in. NLBs kept verbatim (cluster reused, prune on) —
no-NLB convention exception recorded in ADR-007."
```

---

## Task 3: `appset-tempo` ApplicationSet 생성

**Files:**
- Create: `argocd-apps/system/appset-tempo.yaml`

소스 `argocd-korea/apps/appset-tempo.yaml` 기반. 변경점: `repoURL`을 이 repo로, `path`를 `k8s/system/tempo`로, **깨진 ConfigMap `/data/*` 패치 제거**(존재하지 않는 키; tempo는 컨테이너 env로 expand). SA 패치와 Deployment-env 패치는 유지.

- [ ] **Step 1: `argocd-apps/system/appset-tempo.yaml` 작성**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: tempo
  namespace: argocd
spec:
  generators:
    - clusters:
        selector:
          matchLabels:
            cluster-name: mall-apne2-mgmt
        values:
          tempoRoleArn: arn:aws:iam::180294183052:role/production-tempo-ap-northeast-2-mgmt
          tempoS3Bucket: production-mall-tempo-traces-ap-northeast-2-mgmt
          awsRegion: ap-northeast-2
  template:
    metadata:
      name: 'tempo-{{name}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/Atom-oh/AWS-Demo-Platform
        targetRevision: main
        path: k8s/system/tempo
        kustomize:
          patches:
            - target:
                kind: ServiceAccount
                name: tempo
              patch: |-
                - op: replace
                  path: /metadata/annotations/eks.amazonaws.com~1role-arn
                  value: '{{values.tempoRoleArn}}'
            - target:
                kind: Deployment
                name: tempo
              patch: |-
                - op: replace
                  path: /spec/template/spec/containers/0/env
                  value:
                    - name: AWS_REGION
                      value: '{{values.awsRegion}}'
                    - name: TEMPO_S3_BUCKET
                      value: '{{values.tempoS3Bucket}}'
      destination:
        server: '{{server}}'
        namespace: observability
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
          - Replace=true
        retry:
          limit: 5
          backoff:
            duration: 5s
            factor: 2
            maxDuration: 3m
```

- [ ] **Step 2: 검증 게이트 A — appset 구문/스키마**

Run: `kubectl apply --dry-run=client --validate=false -f argocd-apps/system/appset-tempo.yaml`
Expected: PASS — `applicationset.argoproj.io/tempo created (dry run)`

- [ ] **Step 3: 검증 게이트 B — kustomize 패치가 실제로 적용되는지 시뮬레이션**

appset의 kustomize 패치(JSON6902)가 `k8s/system/tempo` 위에서 깨지지 않는지, `k8s/system` 아래 임시 오버레이로 확인(상대경로 `../tempo`가 base를 가리킴):

```bash
mkdir -p k8s/system/.tmp-tempo-check
cat > k8s/system/.tmp-tempo-check/kustomization.yaml <<'EOF'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../tempo
patches:
  - target:
      kind: ServiceAccount
      name: tempo
    patch: |-
      - op: replace
        path: /metadata/annotations/eks.amazonaws.com~1role-arn
        value: arn:aws:iam::180294183052:role/production-tempo-ap-northeast-2-mgmt
  - target:
      kind: Deployment
      name: tempo
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/env
        value:
          - name: AWS_REGION
            value: ap-northeast-2
          - name: TEMPO_S3_BUCKET
            value: production-mall-tempo-traces-ap-northeast-2-mgmt
EOF
kubectl kustomize k8s/system/.tmp-tempo-check | grep -E 'TEMPO_S3_BUCKET|production-mall-tempo-traces'
rm -rf k8s/system/.tmp-tempo-check
```

Expected: PASS — 출력에 `TEMPO_S3_BUCKET` env 와 값 `production-mall-tempo-traces-ap-northeast-2-mgmt`가 나타나고 build 에러 없음. (에러가 나면 패치 경로/매니페스트 불일치 — 중단하고 디버그.) **반드시 `.tmp-tempo-check`를 삭제**(커밋 금지).

- [ ] **Step 4: 커밋**

```bash
git add argocd-apps/system/appset-tempo.yaml
git commit -m "feat(argocd-apps): add appset-tempo targeting this repo

mgmt-only ApplicationSet pointing at k8s/system/tempo. Drops the source's
broken tempo-config /data patch (keys absent; env injected via Deployment
patch + -config.expand-env). repoURL re-pointed to AWS-Demo-Platform."
```

---

## Task 4: `appset-clickhouse` ApplicationSet 생성

**Files:**
- Create: `argocd-apps/system/appset-clickhouse.yaml`

소스 충실 복제, `repoURL`/`path`만 재포인팅.

- [ ] **Step 1: `argocd-apps/system/appset-clickhouse.yaml` 작성**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: clickhouse
  namespace: argocd
spec:
  generators:
    - clusters:
        selector:
          matchLabels:
            cluster-name: mall-apne2-mgmt
  template:
    metadata:
      name: 'clickhouse-{{name}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/Atom-oh/AWS-Demo-Platform
        targetRevision: main
        path: k8s/system/clickhouse-mgmt
      destination:
        server: '{{server}}'
        namespace: observability
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
        retry:
          limit: 5
          backoff:
            duration: 5s
            factor: 2
            maxDuration: 3m
```

- [ ] **Step 2: 검증 게이트**

Run: `kubectl apply --dry-run=client --validate=false -f argocd-apps/system/appset-clickhouse.yaml`
Expected: PASS — `applicationset.argoproj.io/clickhouse created (dry run)`

- [ ] **Step 3: 커밋**

```bash
git add argocd-apps/system/appset-clickhouse.yaml
git commit -m "feat(argocd-apps): add appset-clickhouse targeting this repo

mgmt-only ApplicationSet pointing at k8s/system/clickhouse-mgmt. repoURL
re-pointed to AWS-Demo-Platform. Operator already present via
appset-helm-clickhouse-operator."
```

---

## Task 5: ADR-007 — internal NLB 예외 기록

**Files:**
- Create: `docs/decisions/ADR-007-mgmt-observability-internal-nlb-exception.md`

- [ ] **Step 1: 템플릿 확인**

Run: `sed -n '1,40p' docs/decisions/.template.md`
Expected: ADR 섹션 구조 확인(Status/Context/Decision/Consequences 등)

- [ ] **Step 2: `docs/decisions/ADR-007-mgmt-observability-internal-nlb-exception.md` 작성** (템플릿 구조에 맞춤)

내용 요지(템플릿 섹션에 채움):
- **Status**: Accepted (2026-06-14)
- **Context**: 데모 플랫폼 규약은 CloudFront→ALB→TGB만 허용하고 NLB/Ingress 금지. 그러나 hub(`mall-apne2-mgmt`)에는 spoke(az-a/az-c) otel-collector가 trace/log를 push하고 workload Prometheus가 remote-write하는 cross-cluster fan-in이 존재. ClickHouse native TCP(:9000)는 L7 ALB로 종단 불가, Tempo OTLP/Prometheus remote-write도 L4 종단이 적합. EKS 클러스터는 `multi-region-architecture`와 재사용되며 해당 internal NLB 3개(clickhouse-nlb/tempo-nlb/prometheus-nlb)가 이미 live. ArgoCD `prune: true`이므로 타깃에서 빼면 live NLB가 삭제되어 관측 파이프라인이 끊김.
- **Decision**: `k8s/system/clickhouse-mgmt/internal-nlb-services.yaml`의 internal NLB 3개를 "no-NLB" 규약의 **명시적 예외**로 유지. scheme=internal, SG `sg-0613a5ecf8009daff`로 제한. 외부 노출(public ALB/NLB) 및 Kubernetes Ingress 금지 규약은 그대로 유효.
- **Consequences**: (+) live 관측 fan-in 무중단, 충실한 GitOps 핸드오프. (−) 데이터플레인에 한해 NLB 예외 존재 — 향후 단일 클러스터로 통합 시 in-cluster ClusterIP로 회수 가능. (참고) `[[non-production-tolerance]]`.

- [ ] **Step 3: 커밋**

```bash
git add docs/decisions/ADR-007-mgmt-observability-internal-nlb-exception.md
git commit -m "docs(adr): record internal NLB exception for mgmt observability fan-in (ADR-007)"
```

---

## Task 6: 문서 동기화 + 최종 게이트

**Files:**
- Modify: `k8s/CLAUDE.md` (Key Directories에 tempo/clickhouse-mgmt 추가)
- Modify: `docs/architecture.md` (GitOps/관측 섹션 반영)

- [ ] **Step 1: `k8s/CLAUDE.md` Key Directories에 항목 추가**

`## Key Directories` 목록에 두 항목 추가:

```markdown
- `system/tempo/` — Grafana Tempo 2.7.2 단일 바이너리(S3 백엔드, IRSA `production-tempo-ap-northeast-2-mgmt`). `appset-tempo`가 mgmt에만 배포. `-config.expand-env=true`로 `${TEMPO_S3_BUCKET}`/`${AWS_REGION}`를 컨테이너 env에서 해석.
- `system/clickhouse-mgmt/` — Altinity ClickHouseInstallation(otel 스키마, gp3 100Gi) + internal NLB 3개(spoke→hub fan-in, ADR-007 예외). `appset-clickhouse`가 mgmt에만 배포. operator는 `appset-helm-clickhouse-operator`.
```

- [ ] **Step 2: `docs/architecture.md`에 tempo/clickhouse 타깃 반영**

`docs/architecture.md`에서 GitOps 시스템 Application 목록 또는 관측(observability) 관련 섹션을 찾아, `appset-tempo`(observability ns, mgmt) 및 `appset-clickhouse`(observability ns, mgmt) 항목을 기존 형식에 맞춰 추가. (영문/한글 섹션 모두 존재하면 양쪽에 반영.)

Run(섹션 위치 파악): `grep -nE 'appset|observability|otel-collector|clickhouse-operator|GitOps' docs/architecture.md | head`
편집 후 변경 확인: `grep -nE 'appset-tempo|appset-clickhouse' docs/architecture.md`
Expected: 두 항목이 추가됨.

- [ ] **Step 3: 전체 매니페스트 재검증**

```bash
for d in tempo clickhouse-mgmt; do
  echo "== $d =="; kubectl kustomize "k8s/system/$d" >/dev/null && echo OK || echo FAIL
done
kubectl apply --dry-run=client --validate=false -f argocd-apps/system/appset-tempo.yaml -f argocd-apps/system/appset-clickhouse.yaml
```
Expected: 두 `OK`, 두 appset `created (dry run)`.

- [ ] **Step 4: 최종 게이트 — 하네스 테스트**

Run: `bash tests/run-all.sh`
Expected: PASS — 모든 테스트 통과(베이스라인 47/47 유지, 회귀 없음).

- [ ] **Step 5: 커밋**

```bash
git add k8s/CLAUDE.md docs/architecture.md
git commit -m "docs: sync k8s/CLAUDE.md + architecture for tempo/clickhouse targets"
```

---

## 핸드오프 시퀀싱 (구현 범위 외 — 운영 메모)
이 계획은 manifest + appset을 이 repo에 추가하는 데까지다. 실제 적용:
1. 이 브랜치 PR 머지 (`main`).
2. ArgoCD가 `master-system-root` 재조정 시 `tempo-mall-apne2-mgmt`/`clickhouse-mall-apne2-mgmt` Application 생성.
3. 소스 hub root-app(`multi-region-architecture` `argocd-korea/apps/kustomization.yaml`)에서 `appset-tempo.yaml`/`appset-clickhouse.yaml` 제거(동일 이름 Application 충돌 방지) — 또는 소스 root-app 폐기.
4. **live apply는 사용자 게이트**(Atlantis/ArgoCD). 머지 후 ArgoCD에서 두 Application이 Healthy/Synced인지 확인.

## 비범위
mall 워크로드 appset(core/user/fulfillment/business/platform — tenant 계층, dest `tenants/`가 커버), tempo-west, 비-mgmt clickhouse, keda, fluent-bit, external-secrets/secrets, prometheus alerting-rules(소스 root-app 미동기화), placeholder 디렉토리 정리.
