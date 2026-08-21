import { describe, it, expect, vi } from 'vitest';
import { runJob } from '../job-runner.js';
import type { Project } from '@demo-platform/shared';

const scaleProject: Project = {
  name: 'p',
  github: { repo: 'foo/bar', branch: 'main' },
  account: 'atomoh-main',
  resources: [
    { type: 'ecs', cluster: 'c', service: 's' },
    {
      type: 'argocd-app',
      application: 'app-a',
      cluster: 'cl',
      workload_selector: { namespace: 'ns' },
      hpa_handling: 'scale_to_one',
    },
  ],
};

function makeDdb(stateStatus: string) {
  const stateClient = {
    read: vi.fn(async () => ({ status: stateStatus })),
    markOff: vi.fn(),
    markOn: vi.fn(),
    markError: vi.fn(),
    transition: vi.fn(),
    recordHpaBaselineIfAbsent: vi.fn(),
    readHpaBaseline: vi.fn(async () => null),
  };
  const jobsClient = {
    markRunning: vi.fn(),
    appendProgress: vi.fn(),
    markSucceeded: vi.fn(),
    markPartialFailure: vi.fn(),
    markFailed: vi.fn(),
  };
  const historyClient = { append: vi.fn() };
  return { stateClient, jobsClient, historyClient };
}

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

  it('for argocd-app, records a first-observed HPA baseline and uses it (not the possibly scale-collapsed live value) in restoration_data', async () => {
    // Simulates: an earlier scale() already collapsed the live HPA to {min:5,max:5}
    // and durably recorded the true original {min:2,max:10} as the baseline. turnOff
    // now observes the collapsed {min:5,max:5} live, but restoration_data must end up
    // holding the baseline, not what it just observed — proving the fix.
    const argoCtl = {
      turnOff: vi.fn(async () => ({
        application: 'app-a',
        namespace: 'ns',
        workloads: { web: 1 },
        hpas: { web: { min: 5, max: 5 } }, // already-collapsed live value
      })),
      turnOn: vi.fn(),
    };
    const ecsCtl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const ec2Ctl = { turnOff: vi.fn(), turnOn: vi.fn() };
    const rdsCtl = { turnOff: vi.fn(), turnOn: vi.fn(), waitForAvailable: vi.fn() };
    const stateClient = {
      read: vi.fn(async () => null),
      markOff: vi.fn(),
      markOn: vi.fn(),
      markError: vi.fn(),
      transition: vi.fn(),
      recordHpaBaselineIfAbsent: vi.fn(), // no-op: a baseline already exists
      readHpaBaseline: vi.fn(async () => ({ web: { min: 2, max: 10 } })),
    };
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
        {
          type: 'argocd-app',
          application: 'app-a',
          cluster: 'cl',
          workload_selector: { namespace: 'ns' },
          hpa_handling: 'scale_to_one',
        },
      ],
    };

    await runJob({
      job: { id: 'j-hpa', operation: 'turn_off', repo: 'foo/bar', actor: 'atomoh' },
      project,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: ec2Ctl as never, rds: rdsCtl as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(stateClient.recordHpaBaselineIfAbsent).toHaveBeenCalledWith(
      'foo/bar',
      'argocd-app:app-a',
      { web: { min: 5, max: 5 } }, // what it just observed — a no-op since one already exists
    );
    expect(stateClient.readHpaBaseline).toHaveBeenCalledWith('foo/bar', 'argocd-app:app-a');
    expect(stateClient.markOff).toHaveBeenCalledWith(
      'foo/bar',
      expect.objectContaining({
        restoration_data: expect.objectContaining({
          'argocd-app:app-a': expect.objectContaining({ hpas: { web: { min: 2, max: 10 } } }),
        }),
      }),
    );
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

describe('runJob — scale', () => {
  const noopCtl = () => ({ turnOff: vi.fn(), turnOn: vi.fn() });

  it('(a) an argocd-app target calls the new controller scale()', async () => {
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn(), scale: vi.fn(async () => ({ capturedHpaBounds: {} })) };
    const ecsCtl = { ...noopCtl(), setDesiredCount: vi.fn(async () => undefined) };
    const { stateClient, jobsClient, historyClient } = makeDdb('on');

    await runJob({
      job: {
        id: 'js1',
        operation: 'scale',
        repo: 'foo/bar',
        actor: 'atomoh',
        targets: [{ stepKey: 'argocd-app:app-a', replicas: 5 }],
      },
      project: scaleProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: noopCtl() as never, rds: { ...noopCtl(), waitForAvailable: vi.fn() } as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(argoCtl.scale).toHaveBeenCalledWith('app-a', 'ns', 5);
    expect(ecsCtl.setDesiredCount).not.toHaveBeenCalled();
    expect(jobsClient.markSucceeded).toHaveBeenCalledWith('js1');
  });

  it('(b) an ecs target calls setDesiredCount', async () => {
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn(), scale: vi.fn(async () => ({ capturedHpaBounds: {} })) };
    const ecsCtl = { ...noopCtl(), setDesiredCount: vi.fn(async () => undefined) };
    const { stateClient, jobsClient, historyClient } = makeDdb('on');

    await runJob({
      job: {
        id: 'js2',
        operation: 'scale',
        repo: 'foo/bar',
        actor: 'atomoh',
        targets: [{ stepKey: 'ecs:c/s', desiredCount: 4 }],
      },
      project: scaleProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: noopCtl() as never, rds: { ...noopCtl(), waitForAvailable: vi.fn() } as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(ecsCtl.setDesiredCount).toHaveBeenCalledWith({ cluster: 'c', service: 's', count: 4 });
    expect(argoCtl.scale).not.toHaveBeenCalled();
    expect(jobsClient.markSucceeded).toHaveBeenCalledWith('js2');
  });

  it('(c) one target failing while another succeeds yields partial_failure, both attempted', async () => {
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn(), scale: vi.fn(async () => { throw new Error('argo boom'); }) };
    const ecsCtl = { ...noopCtl(), setDesiredCount: vi.fn(async () => undefined) };
    const { stateClient, jobsClient, historyClient } = makeDdb('on');

    await runJob({
      job: {
        id: 'js3',
        operation: 'scale',
        repo: 'foo/bar',
        actor: 'atomoh',
        targets: [
          { stepKey: 'ecs:c/s', desiredCount: 4 },
          { stepKey: 'argocd-app:app-a', replicas: 5 },
        ],
      },
      project: scaleProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: noopCtl() as never, rds: { ...noopCtl(), waitForAvailable: vi.fn() } as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(ecsCtl.setDesiredCount).toHaveBeenCalled();
    expect(argoCtl.scale).toHaveBeenCalled();
    expect(jobsClient.markPartialFailure).toHaveBeenCalled();
    expect(jobsClient.appendProgress).toHaveBeenCalledWith('js3', 'ecs:c/s', 'done');
    expect(jobsClient.appendProgress).toHaveBeenCalledWith('js3', 'argocd-app:app-a', expect.stringContaining('failed:'));
  });

  it('(d) all targets failing yields failed', async () => {
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn(), scale: vi.fn(async () => { throw new Error('argo boom'); }) };
    const ecsCtl = { ...noopCtl(), setDesiredCount: vi.fn(async () => { throw new Error('ecs boom'); }) };
    const { stateClient, jobsClient, historyClient } = makeDdb('on');

    await runJob({
      job: {
        id: 'js4',
        operation: 'scale',
        repo: 'foo/bar',
        actor: 'atomoh',
        targets: [
          { stepKey: 'ecs:c/s', desiredCount: 4 },
          { stepKey: 'argocd-app:app-a', replicas: 5 },
        ],
      },
      project: scaleProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: noopCtl() as never, rds: { ...noopCtl(), waitForAvailable: vi.fn() } as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(jobsClient.markFailed).toHaveBeenCalled();
    expect(jobsClient.markPartialFailure).not.toHaveBeenCalled();
    expect(jobsClient.markSucceeded).not.toHaveBeenCalled();
  });

  it('(e) state.status is never mutated by a scale job — no markOn/markError', async () => {
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn(), scale: vi.fn(async () => ({ capturedHpaBounds: {} })) };
    const ecsCtl = { ...noopCtl(), setDesiredCount: vi.fn(async () => undefined) };
    const { stateClient, jobsClient, historyClient } = makeDdb('on');

    await runJob({
      job: {
        id: 'js5',
        operation: 'scale',
        repo: 'foo/bar',
        actor: 'atomoh',
        targets: [{ stepKey: 'ecs:c/s', desiredCount: 4 }],
      },
      project: scaleProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: noopCtl() as never, rds: { ...noopCtl(), waitForAvailable: vi.fn() } as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(stateClient.markOn).not.toHaveBeenCalled();
    expect(stateClient.markOff).not.toHaveBeenCalled();
    expect(stateClient.markError).not.toHaveBeenCalled();
  });

  it('(f) an empty or missing targets array fails explicitly rather than resolving succeeded', async () => {
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn(), scale: vi.fn() };
    const ecsCtl = { ...noopCtl(), setDesiredCount: vi.fn() };
    const { stateClient, jobsClient, historyClient } = makeDdb('on');

    await runJob({
      job: { id: 'js6', operation: 'scale', repo: 'foo/bar', actor: 'atomoh', targets: [] },
      project: scaleProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: noopCtl() as never, rds: { ...noopCtl(), waitForAvailable: vi.fn() } as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(jobsClient.markFailed).toHaveBeenCalled();
    expect(jobsClient.markSucceeded).not.toHaveBeenCalled();
    expect(argoCtl.scale).not.toHaveBeenCalled();
    expect(ecsCtl.setDesiredCount).not.toHaveBeenCalled();
  });

  it('(g) a start-of-branch recheck aborts the whole job with no target attempted when the project is no longer on', async () => {
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn(), scale: vi.fn() };
    const ecsCtl = { ...noopCtl(), setDesiredCount: vi.fn() };
    const { stateClient, jobsClient, historyClient } = makeDdb('off');

    await runJob({
      job: {
        id: 'js7',
        operation: 'scale',
        repo: 'foo/bar',
        actor: 'atomoh',
        targets: [{ stepKey: 'ecs:c/s', desiredCount: 4 }],
      },
      project: scaleProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: noopCtl() as never, rds: { ...noopCtl(), waitForAvailable: vi.fn() } as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(ecsCtl.setDesiredCount).not.toHaveBeenCalled();
    expect(argoCtl.scale).not.toHaveBeenCalled();
    expect(jobsClient.appendProgress).not.toHaveBeenCalled();
    expect(jobsClient.markFailed).toHaveBeenCalled();
  });

  it('(i) a target whose stepKey no longer matches any resource fails explicitly, not a vacuous success', async () => {
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn(), scale: vi.fn() };
    const ecsCtl = { ...noopCtl(), setDesiredCount: vi.fn() };
    const { stateClient, jobsClient, historyClient } = makeDdb('on');

    await runJob({
      job: {
        id: 'js8',
        operation: 'scale',
        repo: 'foo/bar',
        actor: 'atomoh',
        targets: [{ stepKey: 'ecs:no-such-cluster/no-such-service', desiredCount: 4 }],
      },
      project: scaleProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: noopCtl() as never, rds: { ...noopCtl(), waitForAvailable: vi.fn() } as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(ecsCtl.setDesiredCount).not.toHaveBeenCalled();
    expect(jobsClient.appendProgress).toHaveBeenCalledWith(
      'js8',
      'ecs:no-such-cluster/no-such-service',
      expect.stringContaining('failed:'),
    );
    expect(jobsClient.markFailed).toHaveBeenCalled();
  });

  it('appends a HistoryClient record for audit parity', async () => {
    const argoCtl = { turnOff: vi.fn(), turnOn: vi.fn(), scale: vi.fn(async () => ({ capturedHpaBounds: {} })) };
    const ecsCtl = { ...noopCtl(), setDesiredCount: vi.fn(async () => undefined) };
    const { stateClient, jobsClient, historyClient } = makeDdb('on');

    await runJob({
      job: {
        id: 'js9',
        operation: 'scale',
        repo: 'foo/bar',
        actor: 'atomoh',
        targets: [{ stepKey: 'ecs:c/s', desiredCount: 4 }],
      },
      project: scaleProject,
      account: 'atomoh-main',
      controllers: { ecs: ecsCtl as never, ec2: noopCtl() as never, rds: { ...noopCtl(), waitForAvailable: vi.fn() } as never, argocd: argoCtl as never },
      ddb: { state: stateClient as never, jobs: jobsClient as never, history: historyClient as never },
      logger,
    });

    expect(historyClient.append).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'foo/bar', action: 'scale', actor: 'atomoh' }),
    );
  });
});
