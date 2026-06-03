# Dashboard runtime (Stage 2 Phase 4, dev). ECS Fargate cluster running:
#   - api    (desiredCount=1) — Fastify; reachable via ALB→CF at admin-api-dev.atomai.click
#   - worker (desiredCount=0) — SQS consumer; scaffolded OFF until its config files are
#     baked into the image and github/argocd secrets are populated (see CLAUDE.md).

resource "aws_ecs_cluster" "this" {
  name = "demo-platform-dev"
  setting {
    name  = "containerInsights"
    value = "disabled" # non-prod cost control
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/demo-platform/dev/api"
  retention_in_days = 14
}
resource "aws_cloudwatch_log_group" "worker" {
  name              = "/demo-platform/dev/worker"
  retention_in_days = 14
}

# Task SG — api accepts 8080 from the ALB SG; both egress anywhere (ECR/AWS APIs).
resource "aws_security_group" "task" {
  name        = "demo-platform-ecs-task-dev"
  description = "Dashboard ECS tasks (api/worker)"
  vpc_id      = data.terraform_remote_state.shared.outputs.vpc_id

  ingress {
    description     = "api container port from Internal ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [data.terraform_remote_state.alb_internal.outputs.alb_sg_id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ───────────────────────── api ─────────────────────────
resource "aws_ecs_task_definition" "api" {
  family                   = "demo-platform-api-dev"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = data.terraform_remote_state.iam.outputs.exec_role_arn
  task_role_arn            = data.terraform_remote_state.iam.outputs.task_role_arn

  runtime_platform {
    cpu_architecture        = "X86_64" # matches the linux/amd64 image build
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name         = "api"
      image        = local.api_image
      essential    = true
      portMappings = [{ containerPort = 8080, protocol = "tcp" }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "8080" },
        { name = "AWS_REGION", value = local.region },
        # Lifecycle Controller deps — api now serves /api/* (not just /health):
        { name = "DDB_TABLE_STATE", value = "demo-platform-state-dev" },
        { name = "DDB_TABLE_JOBS", value = "demo-platform-jobs-dev" },
        { name = "SQS_QUEUE_URL", value = local.sqs_queue_url },
        { name = "PROJECTS_DIR", value = "/app/projects" },
        { name = "ADMIN_USERNAMES", value = "atomoh" },
      ]
      # Cognito ids for the access-token JWT verifier (fail-closed in prod).
      secrets = [
        { name = "COGNITO_USER_POOL_ID", valueFrom = data.aws_secretsmanager_secret.cognito_user_pool_id.arn },
        { name = "COGNITO_APP_CLIENT_ID", valueFrom = data.aws_secretsmanager_secret.cognito_app_client_id.arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = local.region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "demo-platform-api-dev"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.terraform_remote_state.shared.outputs.private_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = data.terraform_remote_state.alb_internal.outputs.dashboard_api_tg_arn
    container_name   = "api"
    container_port   = 8080
  }

  lifecycle {
    # image is rolled by GHA (update-service); desired_count managed out-of-band.
    ignore_changes = [task_definition, desired_count]
  }
}

# ───────────────────────── worker (scaffold, OFF) ─────────────────────────
resource "aws_ecs_task_definition" "worker" {
  family                   = "demo-platform-worker-dev"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = data.terraform_remote_state.iam.outputs.exec_role_arn
  task_role_arn            = data.terraform_remote_state.iam.outputs.task_role_arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = local.worker_image
      essential = true
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "AWS_REGION", value = local.region },
        { name = "DDB_TABLE_STATE", value = "demo-platform-state-dev" },
        { name = "DDB_TABLE_JOBS", value = "demo-platform-jobs-dev" },
        { name = "DDB_TABLE_HISTORY", value = "demo-platform-history-dev" },
        { name = "SQS_QUEUE_URL", value = local.sqs_queue_url },
        { name = "ARGOCD_BASE_URL", value = "https://argocd.atomai.click" },
        { name = "PROJECTS_DIR", value = "/app/projects" },
        { name = "ACCOUNTS_FILE", value = "/app/accounts.yaml" },
      ]
      secrets = [
        { name = "GITHUB_PAT", valueFrom = data.aws_secretsmanager_secret.github_pat.arn },
        { name = "ARGOCD_ADMIN_TOKEN", valueFrom = data.aws_secretsmanager_secret.argocd_token.arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = local.region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "worker" {
  name            = "demo-platform-worker-dev"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 0 # OFF until config files baked into image + secrets populated
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.terraform_remote_state.shared.outputs.private_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}
