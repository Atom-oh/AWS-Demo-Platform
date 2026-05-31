import { describe, it, expect, beforeEach } from 'vitest';
import {
  RDSClient,
  DescribeDBInstancesCommand,
  StopDBInstanceCommand,
  StartDBInstanceCommand,
} from '@aws-sdk/client-rds';
import { mockClient } from 'aws-sdk-client-mock';
import { RdsController } from '../rds.js';

const rdsMock = mockClient(RDSClient);
beforeEach(() => rdsMock.reset());

describe('RdsController.turnOff', () => {
  it('stops available DB and returns previous_status', async () => {
    rdsMock.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [{ DBInstanceStatus: 'available' }],
    });
    rdsMock.on(StopDBInstanceCommand).resolves({});

    const c = new RdsController({ client: rdsMock as unknown as RDSClient });
    const rd = await c.turnOff({ db_identifier: 'mydb' });
    expect(rd.previous_status).toBe('available');
    expect(rdsMock.commandCalls(StopDBInstanceCommand)).toHaveLength(1);
  });

  it('skip if already stopped (idempotent)', async () => {
    rdsMock.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [{ DBInstanceStatus: 'stopped' }],
    });
    const c = new RdsController({ client: rdsMock as unknown as RDSClient });
    await c.turnOff({ db_identifier: 'mydb' });
    expect(rdsMock.commandCalls(StopDBInstanceCommand)).toHaveLength(0);
  });
});

describe('RdsController.turnOn (synchronous start call)', () => {
  it('issues StartDBInstance and returns immediately (polling is caller responsibility)', async () => {
    rdsMock.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [{ DBInstanceStatus: 'stopped' }],
    });
    rdsMock.on(StartDBInstanceCommand).resolves({});
    const c = new RdsController({ client: rdsMock as unknown as RDSClient });
    await c.turnOn({ db_identifier: 'mydb', previous_status: 'available' });
    expect(rdsMock.commandCalls(StartDBInstanceCommand)).toHaveLength(1);
  });

  it('skip if already available', async () => {
    rdsMock.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [{ DBInstanceStatus: 'available' }],
    });
    const c = new RdsController({ client: rdsMock as unknown as RDSClient });
    await c.turnOn({ db_identifier: 'mydb', previous_status: 'available' });
    expect(rdsMock.commandCalls(StartDBInstanceCommand)).toHaveLength(0);
  });
});

describe('RdsController.waitForAvailable', () => {
  it('polls describe until available', async () => {
    rdsMock
      .on(DescribeDBInstancesCommand)
      .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'starting' }] })
      .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'available' }] });
    const c = new RdsController({
      client: rdsMock as unknown as RDSClient,
      pollIntervalMs: 1,
      maxPollMs: 5000,
    });
    await c.waitForAvailable('mydb');
    expect(rdsMock.commandCalls(DescribeDBInstancesCommand).length).toBeGreaterThanOrEqual(2);
  });

  it('throws if timeout exceeded', async () => {
    rdsMock.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [{ DBInstanceStatus: 'starting' }],
    });
    const c = new RdsController({
      client: rdsMock as unknown as RDSClient,
      pollIntervalMs: 1,
      maxPollMs: 5,
    });
    await expect(c.waitForAvailable('mydb')).rejects.toThrow(/timeout/);
  });
});
