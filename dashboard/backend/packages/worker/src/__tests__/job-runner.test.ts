import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runJob } from '../job-runner.js';
import type { Project } from '@demo-platform/shared';

const baseProject: Project = {
  name: 'p',
  github: { repo: 'foo/bar', branch: 'main' },
  account: 'atomoh-main',
  resources: [{ type: 'ecs', cluster: 'c', service: 's' }],
};

describe('runJob', () => {
  it('runs turn_off for ECS and updates state + jobs + history', async () => {
    const ecsCtl = { turnOff: vi.fn(async () => ({ cluster: 'c', service: 's', original_desired_count: 3 })), turnOn: vi.fn() };
    const ec2Ctl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const rdsCtl = { turnOff: vi.fn(), turnOn: vi.fn(), waitForAvailable: vi.fn() };
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const stateClient = {
      markOff: vi.fn(),
      markOn: vi.fn(),
      markError: vi.fn(),
      transition: vi.fn(),
    };
    const jobsClient = {
      markRunning: vi.fn(),
      appendProgress: vi.fn(),
      markSucceeded: vi.fn(),
      markPartialFailure: vi.fn(),
      markFailed: vi.fn(),
    };
    const historyClient = { append: vi.fn() };

    await runJob({
      job: { id: 'j1', operation: 'turn_off', repo: 'foo/bar', actor: 'atomoh' },
      project: baseProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: ec2Ctl as never, rds: rdsCtl as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    });

    expect(jobsClient.markRunning).toHaveBeenCalled();
    expect(ecsCtl.turnOff).toHaveBeenCalledWith({ cluster: 'c', service: 's' });
    expect(stateClient.markOff).toHaveBeenCalledWith('foo/bar', expect.objectContaining({ restoration_data: expect.objectContaining({ ecs: { cluster: 'c', service: 's', original_desired_count: 3 } }) }));
    expect(jobsClient.markSucceeded).toHaveBeenCalledWith('j1');
    expect(historyClient.append).toHaveBeenCalled();
  });

  it('handles partial_failure when one controller throws', async () => {
    const ecsCtl = { turnOff: vi.fn(async () => ({ cluster: 'c', service: 's', original_desired_count: 1 })), turnOn: vi.fn() };
    const ec2Ctl = { turnOff: vi.fn(async () => { throw new Error('boom'); }), turnOn: vi.fn() };
    const rdsCtl = { turnOff: vi.fn(), turnOn: vi.fn(), waitForAvailable: vi.fn() };
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const stateClient = { markOff: vi.fn(), markOn: vi.fn(), markError: vi.fn(), transition: vi.fn() };
    const jobsClient = {
      markRunning: vi.fn(),
      appendProgress: vi.fn(),
      markSucceeded: vi.fn(),
      markPartialFailure: vi.fn(),
      markFailed: vi.fn(),
    };
    const historyClient = { append: vi.fn() };

    const project: Project = {
      ...baseProject,
      resources: [
        { type: 'ecs', cluster: 'c', service: 's' },
        { type: 'ec2', instance_ids: ['i-1'] },
      ],
    };

    await runJob({
      job: { id: 'j2', operation: 'turn_off', repo: 'foo/bar', actor: 'a' },
      project,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: ec2Ctl as never, rds: rdsCtl as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    });

    expect(jobsClient.markPartialFailure).toHaveBeenCalled();
    expect(stateClient.markOff).toHaveBeenCalled(); // partial: still mark off with what succeeded
  });
});
