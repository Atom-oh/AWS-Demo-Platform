import { describe, it, expect } from 'vitest';
import { ProjectSchema, type Project } from '../project.js';

const validProject = {
  name: 'multi-region-mall',
  github: { repo: 'Atom-oh/multi-region-architecture', branch: 'main' },
  description: 'mall demo',
  account: 'atomoh-main',
  display: { category: 'workshop' },
  resources: [
    { type: 'ecs', cluster: 'mall-cluster', service: 'web' },
    { type: 'ec2', instance_ids: ['i-0123456789abcdef0'] },
    {
      type: 'argocd-app',
      application: 'mall',
      cluster: 'mall-apne2-mgmt',
      workload_selector: { namespace: 'mall' },
      hpa_handling: 'scale_to_one',
    },
    { type: 'rds', db_identifier: 'mall-db', always_on: false },
    { type: 'dynamodb', table_names: ['orders'], always_on: true },
  ],
  urls: { demo: 'https://mall.atomai.click' },
};

describe('ProjectSchema', () => {
  it('parses a full valid project', () => {
    const p: Project = ProjectSchema.parse(validProject);
    expect(p.name).toBe('multi-region-mall');
    expect(p.resources).toHaveLength(5);
  });

  it('rejects when resource type unknown', () => {
    expect(() =>
      ProjectSchema.parse({
        ...validProject,
        resources: [{ type: 'lambda' }],
      }),
    ).toThrow();
  });

  it('defaults hpa_handling to scale_to_one when omitted', () => {
    const p = ProjectSchema.parse({
      ...validProject,
      resources: [
        {
          type: 'argocd-app',
          application: 'x',
          cluster: 'c',
          workload_selector: { namespace: 'n' },
        },
      ],
    });
    const r = p.resources[0];
    if (r.type !== 'argocd-app') throw new Error('wrong type');
    expect(r.hpa_handling).toBe('scale_to_one');
  });

  it('rejects ec2 with empty instance_ids', () => {
    expect(() =>
      ProjectSchema.parse({
        ...validProject,
        resources: [{ type: 'ec2', instance_ids: [] }],
      }),
    ).toThrow();
  });

  it('treats dynamodb/elasticache/kafka as always-on visibility-only', () => {
    const p = ProjectSchema.parse({
      ...validProject,
      resources: [
        { type: 'dynamodb', table_names: ['t1'], always_on: true },
        { type: 'elasticache', cluster_id: 'c1', always_on: true },
        { type: 'kafka', cluster_arn: 'arn:...', always_on: true },
      ],
    });
    expect(p.resources).toHaveLength(3);
  });
});
