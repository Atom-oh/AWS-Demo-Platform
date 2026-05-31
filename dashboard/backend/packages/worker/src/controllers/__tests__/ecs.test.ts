import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECSClient,
  DescribeServicesCommand,
  UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import { mockClient } from 'aws-sdk-client-mock';
import { EcsController } from '../ecs.js';

const ecsMock = mockClient(ECSClient);

beforeEach(() => ecsMock.reset());

describe('EcsController.turnOff', () => {
  it('records original desired count and sets desiredCount=0', async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [{ desiredCount: 3 }],
    });
    ecsMock.on(UpdateServiceCommand).resolves({});

    const c = new EcsController({ client: ecsMock as unknown as ECSClient });
    const rd = await c.turnOff({ cluster: 'c', service: 's' });
    expect(rd).toEqual({ cluster: 'c', service: 's', original_desired_count: 3 });
    const calls = ecsMock.commandCalls(UpdateServiceCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({ cluster: 'c', service: 's', desiredCount: 0 });
  });

  it('is idempotent when desiredCount already 0 (no UpdateService call)', async () => {
    ecsMock.on(DescribeServicesCommand).resolves({ services: [{ desiredCount: 0 }] });
    const c = new EcsController({ client: ecsMock as unknown as ECSClient });
    const rd = await c.turnOff({ cluster: 'c', service: 's' });
    expect(rd.original_desired_count).toBe(0);
    expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(0);
  });
});

describe('EcsController.turnOn', () => {
  it('restores desired count from restoration_data', async () => {
    ecsMock.on(DescribeServicesCommand).resolves({ services: [{ desiredCount: 0 }] });
    ecsMock.on(UpdateServiceCommand).resolves({});
    const c = new EcsController({ client: ecsMock as unknown as ECSClient });
    await c.turnOn({ cluster: 'c', service: 's', original_desired_count: 5 });
    const calls = ecsMock.commandCalls(UpdateServiceCommand);
    expect(calls[0].args[0].input).toMatchObject({ desiredCount: 5 });
  });

  it('skip when already at target (idempotent)', async () => {
    ecsMock.on(DescribeServicesCommand).resolves({ services: [{ desiredCount: 5 }] });
    const c = new EcsController({ client: ecsMock as unknown as ECSClient });
    await c.turnOn({ cluster: 'c', service: 's', original_desired_count: 5 });
    expect(ecsMock.commandCalls(UpdateServiceCommand)).toHaveLength(0);
  });
});
