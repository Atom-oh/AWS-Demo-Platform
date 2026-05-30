import { z } from 'zod';

export const ProjectStatus = z.enum(['on', 'off', 'transitioning', 'error']);
export type ProjectStatusT = z.infer<typeof ProjectStatus>;

export const JobStatus = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'partial_failure',
]);
export type JobStatusT = z.infer<typeof JobStatus>;

const RestorationData = z.record(z.unknown());

export const StateRecordSchema = z
  .object({
    pk: z.string().startsWith('project#'),
    sk: z.literal('current'),
    status: ProjectStatus,
    last_action: z.enum(['turn_on', 'turn_off', 'init']).optional(),
    last_action_at: z.string().optional(),
    last_actor: z.string().optional(),
    restoration_data: RestorationData.optional(),
    error_message: z.string().optional(),
    updated_at: z.string(),
  })
  .superRefine((rec, ctx) => {
    if (rec.status === 'off' && !rec.restoration_data) {
      ctx.addIssue({
        code: 'custom',
        path: ['restoration_data'],
        message: 'restoration_data is required when status=off',
      });
    }
  });

export type StateRecord = z.infer<typeof StateRecordSchema>;

export const JobRecordSchema = z.object({
  pk: z.string().startsWith('job#'),
  gsi1pk: z.string().startsWith('project#'),
  gsi1sk: z.string(),
  operation: z.enum(['turn_off', 'turn_on', 'add_secret']),
  status: JobStatus,
  progress: z.record(z.string()),
  error: z.string().optional(),
  created_at: z.string(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  ttl: z.number().int().positive(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

export const HistoryRecordSchema = z.object({
  pk: z.string().startsWith('project#'),
  sk: z.string().regex(/^.+#.+$/),
  action: z.string().min(1),
  actor: z.string().min(1),
  account: z.string().min(1),
  result: z.enum(['success', 'failure', 'partial']),
  details: z.record(z.unknown()).optional(),
  ttl: z.number().int().positive(),
});
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>;
