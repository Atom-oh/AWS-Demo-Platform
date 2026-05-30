import { z } from 'zod';

export const EcsResource = z.object({
  type: z.literal('ecs'),
  cluster: z.string().min(1),
  service: z.string().min(1),
});

export const Ec2Resource = z.object({
  type: z.literal('ec2'),
  instance_ids: z.array(z.string().regex(/^i-[0-9a-f]+$/)).min(1),
});

export const ArgocdResource = z.object({
  type: z.literal('argocd-app'),
  application: z.string().min(1),
  cluster: z.string().min(1),
  workload_selector: z.object({ namespace: z.string().min(1) }),
  hpa_handling: z.enum(['scale_to_one', 'ignore', 'delete']).default('scale_to_one'),
});

export const RdsResource = z.object({
  type: z.literal('rds'),
  db_identifier: z.string().min(1),
  always_on: z.boolean().default(false),
});

export const DynamoDbResource = z.object({
  type: z.literal('dynamodb'),
  table_names: z.array(z.string().min(1)).min(1),
  always_on: z.literal(true),
});

export const ElastiCacheResource = z.object({
  type: z.literal('elasticache'),
  cluster_id: z.string().min(1),
  always_on: z.literal(true),
});

export const KafkaResource = z.object({
  type: z.literal('kafka'),
  cluster_arn: z.string().min(1),
  always_on: z.literal(true),
});

export const ResourceRef = z.discriminatedUnion('type', [
  EcsResource,
  Ec2Resource,
  ArgocdResource,
  RdsResource,
  DynamoDbResource,
  ElastiCacheResource,
  KafkaResource,
]);

export const CodeServerUrl = z.union([
  z.object({ mode: z.literal('explicit'), url: z.string().url() }),
  z.object({ mode: z.literal('ec2-tag'), tag: z.string().min(1) }),
]);

export const ProjectSchema = z.object({
  name: z.string().min(1),
  github: z.object({
    repo: z.string().regex(/^[^/]+\/[^/]+$/),
    branch: z.string().default('main'),
  }),
  description: z.string().optional(),
  account: z.string().min(1),
  display: z
    .object({
      category: z.string().optional(),
    })
    .partial()
    .optional(),
  resources: z.array(ResourceRef).min(1),
  urls: z
    .object({
      demo: z.string().url().optional(),
      code_server: CodeServerUrl.optional(),
    })
    .partial()
    .optional(),
  secrets: z
    .object({
      manage_prefix: z.string().startsWith('/').optional(),
    })
    .partial()
    .optional(),
});

export type Project = z.infer<typeof ProjectSchema>;
export type ResourceRefT = z.infer<typeof ResourceRef>;
