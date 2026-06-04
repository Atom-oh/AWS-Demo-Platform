import { describe, it, expect, vi } from 'vitest';
import { runJob } from '../job-runner.js';
import type { Project } from '@demo-platform/shared';

const baseProject: Project = {
  name: 'p',
  github: { repo: 'foo/bar', branch: 'main' },
  account: 'atomoh-main',
  resources: [{ type: 'ecs', cluster: 'c', service: 's' }],
};

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe('runJob — turn_off', () => {
  it('runs turn_off for ECS and updates state + jobs + history', async () => {
    const ecsCtl = { turnOff: vi.fn(async () => ({ cluster: 'c', service: 's', original_desired_count: 3 })), turnOn: vi.fn() };
    const ec2Ctl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const rdsCtl = { turnOff: vi.fn(), turnOn: vi.fn(), waitForAvailable: vi.fn() };
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const stateClient = { read: vi.fn(async () => null), markOff: vi.fn(), markOn: vi.fn(), markError: vi.fn(), transition: vi.fn() };
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
      logger,
    });

    expect(jobsClient.markRunning).toHaveBeenCalled();
    expect(ecsCtl.turnOff).toHaveBeenCalledWith({ cluster: 'c', service: 's' });
    // restoration_data is keyed by the UNIQUE per-resource stepKey (`ecs:c/s`).
    expect(stateClient.markOff).toHaveBeenCalledWith(
      'foo/bar',
      expect.objectContaining({
        restoration_data: expect.objectContaining({ 'ecs:c/s': { cluster: 'c', service: 's', original_desired_count: 3 } }),
      }),
    );
    expect(stateClient.read).not.toHaveBeenCalled(); // read is only for turn_on
    expect(jobsClient.markSucceeded).toHaveBeenCalledWith('j1');
    expect(historyClient.append).toHaveBeenCalled();
  });

  it('handles partial_failure when one controller throws (turn_off still marks off)', async () => {
    const ecsCtl = { turnOff: vi.fn(async () => ({ cluster: 'c', service: 's', original_desired_count: 1 })), turnOn: vi.fn() };
    const ec2Ctl = { turnOff: vi.fn(async () => { throw new Error('boom'); }), turnOn: vi.fn() };
    const rdsCtl = { turnOff: vi.fn(), turnOn: vi.fn(), waitForAvailable: vi.fn() };
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const stateClient = { read: vi.fn(async () => null), markOff: vi.fn(), markOn: vi.fn(), markError: vi.fn(), transition: vi.fn() };
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
      logger,
    });

    expect(jobsClient.markPartialFailure).toHaveBeenCalled();
    expect(stateClient.markOff).toHaveBeenCalled(); // partial: still mark off with what succeeded
    expect(stateClient.markError).not.toHaveBeenCalled();
  });
});

describe('runJob — turn_on', () => {
  const makeJobs = () => ({
    markRunning: vi.fn(),
    appendProgress: vi.fn(),
    markSucceeded: vi.fn(),
    markPartialFailure: vi.fn(),
    markFailed: vi.fn(),
  });

  it('restores ECS from restoration_data and marks on', async () => {
    const ecsCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const ec2Ctl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const rdsCtl = { turnOff: vi.fn(), turnOn: vi.fn(), waitForAvailable: vi.fn() };
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const stateClient = {
      read: vi.fn(async () => ({ status: 'transitioning', restoration_data: { 'ecs:c/s': { cluster: 'c', service: 's', original_desired_count: 3 } } })),
      markOff: vi.fn(),
      markOn: vi.fn(),
      markError: vi.fn(),
      transition: vi.fn(),
    };
    const jobsClient = makeJobs();
    const historyClient = { append: vi.fn() };

    await runJob({
      job: { id: 'j3', operation: 'turn_on', repo: 'foo/bar', actor: 'atomoh' },
      project: baseProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: ec2Ctl as never, rds: rdsCtl as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(stateClient.read).toHaveBeenCalledWith('foo/bar');
    expect(ecsCtl.turnOn).toHaveBeenCalledWith({ cluster: 'c', service: 's', original_desired_count: 3 });
    expect(stateClient.markOn).toHaveBeenCalledWith('foo/bar');
    expect(stateClient.markOff).not.toHaveBeenCalled();
    expect(stateClient.markError).not.toHaveBeenCalled();
    expect(jobsClient.markSucceeded).toHaveBeenCalledWith('j3');
  });

  it('dispatches each resource its own keyed restoration (incl. two argocd-app)', async () => {
    const ecsCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const ec2Ctl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const rdsCtl = { turnOff: vi.fn(), turnOn: vi.fn(), waitForAvailable: vi.fn() };
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const rdA = { application: 'app-a', workloads: { d1: 2 }, hpas: { h1: { min: 2, max: 5 } } };
    const rdB = { application: 'app-b', workloads: { d2: 1 }, hpas: { h2: { min: 1, max: 3 } } };
    const stateClient = {
      read: vi.fn(async () => ({
        status: 'transitioning',
        restoration_data: {
          'ec2:i-1': { instances: [{ instance_id: 'i-1', previous_state: 'running' }] },
          'argocd-app:app-a': rdA,
          'argocd-app:app-b': rdB,
        },
      })),
      markOff: vi.fn(), markOn: vi.fn(), markError: vi.fn(), transition: vi.fn(),
    };
    const jobsClient = makeJobs();
    const historyClient = { append: vi.fn() };

    const project: Project = {
      ...baseProject,
      resources: [
        { type: 'ec2', instance_ids: ['i-1'] },
        { type: 'argocd-app', application: 'app-a', cluster: 'cl', workload_selector: { namespace: 'ns-a' }, hpa_handling: 'scale_to_one' },
        { type: 'argocd-app', application: 'app-b', cluster: 'cl', workload_selector: { namespace: 'ns-b' }, hpa_handling: 'scale_to_one' },
      ],
    };

    await runJob({
      job: { id: 'j4', operation: 'turn_on', repo: 'foo/bar', actor: 'atomoh' },
      project,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: ec2Ctl as never, rds: rdsCtl as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(ec2Ctl.turnOn).toHaveBeenCalledWith({ instances: [{ instance_id: 'i-1', previous_state: 'running' }] });
    // Both argocd-app resources restored — proves the unique-key fix (no collision).
    expect(argoCtl.turnOn).toHaveBeenCalledTimes(2);
    expect(argoCtl.turnOn).toHaveBeenCalledWith(rdA);
    expect(argoCtl.turnOn).toHaveBeenCalledWith(rdB);
    expect(stateClient.markOn).toHaveBeenCalledWith('foo/bar');
  });

  it('is idempotent when restoration_data is empty (no controller calls, still marks on)', async () => {
    const ecsCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const ec2Ctl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const rdsCtl = { turnOff: vi.fn(), turnOn: vi.fn(), waitForAvailable: vi.fn() };
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const stateClient = { read: vi.fn(async () => ({ status: 'transitioning' })), markOff: vi.fn(), markOn: vi.fn(), markError: vi.fn(), transition: vi.fn() };
    const jobsClient = makeJobs();
    const historyClient = { append: vi.fn() };

    await runJob({
      job: { id: 'j5', operation: 'turn_on', repo: 'foo/bar', actor: 'atomoh' },
      project: baseProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: ec2Ctl as never, rds: rdsCtl as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(ecsCtl.turnOn).not.toHaveBeenCalled();
    expect(stateClient.markOn).toHaveBeenCalledWith('foo/bar');
    expect(jobsClient.markSucceeded).toHaveBeenCalledWith('j5');
  });

  it('on partial turn_on failure calls markError (preserve restoration_data), not markOn', async () => {
    const ecsCtl = { turnOff: vi.fn(), turnOn: vi.fn(async () => { throw new Error('boom'); }) };
    const ec2Ctl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const rdsCtl = { turnOff: vi.fn(), turnOn: vi.fn(), waitForAvailable: vi.fn() };
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const stateClient = {
      read: vi.fn(async () => ({
        status: 'transitioning',
        restoration_data: {
          'ecs:c/s': { cluster: 'c', service: 's', original_desired_count: 2 },
          'ec2:i-9': { instances: [{ instance_id: 'i-9', previous_state: 'running' }] },
        },
      })),
      markOff: vi.fn(), markOn: vi.fn(), markError: vi.fn(), transition: vi.fn(),
    };
    const jobsClient = makeJobs();
    const historyClient = { append: vi.fn() };

    const project: Project = {
      ...baseProject,
      resources: [
        { type: 'ecs', cluster: 'c', service: 's' },
        { type: 'ec2', instance_ids: ['i-9'] },
      ],
    };

    await runJob({
      job: { id: 'j6', operation: 'turn_on', repo: 'foo/bar', actor: 'atomoh' },
      project,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: ec2Ctl as never, rds: rdsCtl as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(ec2Ctl.turnOn).toHaveBeenCalled(); // loop continued past the ECS failure
    expect(stateClient.markError).toHaveBeenCalled();
    expect(stateClient.markOn).not.toHaveBeenCalled();
    expect(jobsClient.markPartialFailure).toHaveBeenCalled();
  });

  it('starts RDS and polls availability fire-and-forget (does not await waitForAvailable)', async () => {
    const ecsCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const ec2Ctl = { turnOff: vi.fn(), turnOn: vi.fn() };
    let waitResolved = false;
    const rdsCtl = {
      turnOff: vi.fn(),
      turnOn: vi.fn(),
      // never resolves within the test; if runJob awaited it, this test would hang.
      waitForAvailable: vi.fn(() => new Promise<void>(() => { waitResolved = false; })),
    };
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const stateClient = {
      read: vi.fn(async () => ({ status: 'transitioning', restoration_data: { 'rds:db-1': { db_identifier: 'db-1', previous_status: 'available' } } })),
      markOff: vi.fn(), markOn: vi.fn(), markError: vi.fn(), transition: vi.fn(),
    };
    const jobsClient = makeJobs();
    const historyClient = { append: vi.fn() };

    const project: Project = {
      ...baseProject,
      resources: [{ type: 'rds', db_identifier: 'db-1', always_on: false }],
    };

    await runJob({
      job: { id: 'j7', operation: 'turn_on', repo: 'foo/bar', actor: 'atomoh' },
      project,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: ec2Ctl as never, rds: rdsCtl as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(rdsCtl.turnOn).toHaveBeenCalledWith({ db_identifier: 'db-1', previous_status: 'available' });
    expect(rdsCtl.waitForAvailable).toHaveBeenCalledWith('db-1');
    expect(waitResolved).toBe(false); // proves runJob resolved without awaiting the poll
    expect(jobsClient.markSucceeded).toHaveBeenCalledWith('j7');
  });
});
