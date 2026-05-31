import { z } from 'zod';

const RoleRef = z.object({
  arn: z.string().regex(/^arn:aws:iam::\d{12}:role\/.+$/),
  external_id_secret: z
    .string()
    .regex(/^\/demo-platform\/external-ids\/[^/]+\/(operator|terraformer)$/),
});

export const AccountSchema = z.object({
  name: z.string().min(1),
  account_id: z.string().regex(/^\d{12}$/),
  region: z.string().min(1),
  roles: z.object({
    operator: RoleRef,
    terraformer: RoleRef,
  }),
});

export const AccountsFileSchema = z.object({
  accounts: z.array(AccountSchema).min(1),
});

export type Account = z.infer<typeof AccountSchema>;
export type AccountsFile = z.infer<typeof AccountsFileSchema>;
