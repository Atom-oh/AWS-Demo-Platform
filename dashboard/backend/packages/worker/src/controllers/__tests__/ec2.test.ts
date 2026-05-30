import { describe, it, expect, beforeEach } from 'vitest';
import {
  EC2Client,
  DescribeInstancesCommand,
  StopInstancesCommand,
  StartInstancesCommand,
} from '@aws-sdk/client-ec2';
import { mockClient } from 'aws-sdk-client-mock';
import { Ec2Controller } from '../ec2.js';

const ec2Mock = mockClient(EC2Client);
beforeEach(() => ec2Mock.reset());

describe('Ec2Controller.turnOff', () => {
  it('stops only instances currently running', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [
        {
          Instances: [
            { InstanceId: 'i-1', State: { Name: 'running' } },
            { InstanceId: 'i-2', State: { Name: 'stopped' } },
          ],
        },
      ],
    });
    ec2Mock.on(StopInstancesCommand).resolves({});
    const c = new Ec2Controller({ client: ec2Mock as unknown as EC2Client });
    const rd = await c.turnOff({ instance_ids: ['i-1', 'i-2'] });
    expect(rd.instances).toEqual([
      { instance_id: 'i-1', previous_state: 'running' },
      { instance_id: 'i-2', previous_state: 'stopped' },
    ]);
    const stopCalls = ec2Mock.commandCalls(StopInstancesCommand);
    expect(stopCalls[0].args[0].input.InstanceIds).toEqual(['i-1']);
  });

  it('skip when no instance running (idempotent)', async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [{ Instances: [{ InstanceId: 'i-1', State: { Name: 'stopped' } }] }],
    });
    const c = new Ec2Controller({ client: ec2Mock as unknown as EC2Client });
    await c.turnOff({ instance_ids: ['i-1'] });
    expect(ec2Mock.commandCalls(StopInstancesCommand)).toHaveLength(0);
  });
});

describe('Ec2Controller.turnOn', () => {
  it('starts only instances whose previous_state was running', async () => {
    ec2Mock.on(StartInstancesCommand).resolves({});
    const c = new Ec2Controller({ client: ec2Mock as unknown as EC2Client });
    await c.turnOn({
      instances: [
        { instance_id: 'i-1', previous_state: 'running' },
        { instance_id: 'i-2', previous_state: 'stopped' },
      ],
    });
    const calls = ec2Mock.commandCalls(StartInstancesCommand);
    expect(calls[0].args[0].input.InstanceIds).toEqual(['i-1']);
  });
});
