# ADR-001: SQS + dedicated worker for async lifecycle jobs

**Status:** Accepted (Stage 2, 2026-05-28)
**Context spec:** `docs/superpowers/specs/2026-05-28-stage-2-lifecycle-controller-design.md`

## Context

The Lifecycle Controller turns demo resources on/off. A toggle can take seconds
(ECS desiredCount) to minutes (RDS start polling), so it must be asynchronous:
the API returns `202 + job_id` immediately and the work happens in the
background. We needed a queue + execution model.

Options considered:
1. **In-process queue** in the API task (promise queue + DDB jobs). Simplest, no
   extra infra, but loses in-flight jobs on task restart and couples API latency
   to job load.
2. **SQS + a dedicated `worker` ECS service.** One more queue + one more Fargate
   task, but durable, decoupled, and restart-safe.
3. **Step Functions.** Over-engineered for a single-admin non-prod tool.

## Decision

**Option 2.** The `api` service enqueues to `demo-platform-jobs-dev`; a separate
`worker` service long-polls and processes jobs idempotently. Job state lives in
the `jobs` DynamoDB table. On worker startup a sweep re-enqueues any jobs left in
`running` (crash recovery). SQS visibility timeout is 300s; long RDS-start
polling runs in a background promise after the message is deleted to avoid
redelivery.

## Consequences

- Durable across task restarts; API stays responsive under load.
- Costs one extra Fargate task (~$14/mo) + SQS (negligible) — acceptable per the
  non-production tolerance.
- Idempotency is mandatory in every controller (already required for retries).
- DLQ (`maxReceiveCount=3`) captures poison messages.
