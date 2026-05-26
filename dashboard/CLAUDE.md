# dashboard/ Module

## Role
Stage 3 admin UI + API for AWS Demo Platform. Currently a scaffold (`backend/` and `frontend/` are empty placeholders). Will be filled in Stage 3.

## Planned Stack
- **Frontend**: Next.js + TypeScript. Master-detail layout: left rail of projects, right pane shows resources / URLs / toggle controls.
- **Backend**: Node.js + TypeScript. Express or Fastify. REST API.
- **Runtime**: ECS Fargate behind the same Internal ALB (new target group + listener rule), routed from CloudFront.
- **Auth**: Cognito hosted UI for admin login.
- **Data sources**: GitHub (repo discovery), ArgoCD API (app status + sync trigger), AWS APIs (ECS/EC2/RDS describe + start/stop), Secrets Manager (add secrets).
- **State**: DynamoDB for project metadata cache and operation history.

## Planned Layout
```
dashboard/
  backend/
    src/
      api/          # REST handlers
      services/     # GitHub, ArgoCD, AWS adapters
      persistence/  # DynamoDB access
    package.json
    tsconfig.json
  frontend/
    src/
      pages/        # Next.js routes
      components/   # UI primitives
      hooks/        # API client hooks
    package.json
    tsconfig.json
```

## Rules (when implementation begins)
- TypeScript strict mode on both sides.
- No AWS SDK calls from the frontend — go through the backend.
- All cross-account ops route through the backend, which assumes the configured `OperatorRole`/`DemoPlatformTerraformer` per `accounts.yaml`.
- Frontend never sees AWS credentials. Backend never persists tokens (uses IRSA → STS).
- Pages mount under `/` after Cognito auth. CF routes everything to one ALB listener rule.
