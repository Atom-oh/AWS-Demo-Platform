import { z } from 'zod';

const commonSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  AWS_REGION: z.string().min(1),
  AWS_ENDPOINT_URL: z.string().optional(),
  DDB_TABLE_STATE: z.string().min(1),
  DDB_TABLE_JOBS: z.string().min(1),
  DDB_TABLE_HISTORY: z.string().min(1),
  SQS_QUEUE_URL: z.string().url(),
  PROJECTS_DIR: z.string().min(1),
  ACCOUNTS_FILE: z.string().min(1),
  GITHUB_PAT: z.string().min(1),
  ARGOCD_BASE_URL: z.string().url(),
  ARGOCD_ADMIN_TOKEN: z.string().min(1),
});

const apiSchema = commonSchema.extend({
  PORT: z.coerce.number().int().positive().default(8080),
  ADMIN_USERNAMES: z
    .string()
    .min(1)
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  COGNITO_USER_POOL_ID: z.string().min(1),
  COGNITO_APP_CLIENT_ID: z.string().min(1),
});

const workerSchema = commonSchema.extend({
  WORKER_POLL_WAIT_SECONDS: z.coerce.number().int().min(0).max(20).default(20),
});

export type CommonEnv = z.infer<typeof commonSchema>;
export type ApiEnv = z.infer<typeof apiSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;

export function loadCommonEnv(source: Record<string, string | undefined> = process.env): CommonEnv {
  return commonSchema.parse(source);
}

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return apiSchema.parse(source);
}

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return workerSchema.parse(source);
}
