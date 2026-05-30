import {
  DescribeDBInstancesCommand,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
  type RDSClient,
} from '@aws-sdk/client-rds';
import { PermanentError, TransientError, classifyAwsError } from '@demo-platform/shared';

export interface RdsRestorationData {
  db_identifier: string;
  previous_status: string;
}

export interface RdsControllerOpts {
  client: RDSClient;
  pollIntervalMs?: number;
  maxPollMs?: number;
}

export class RdsController {
  constructor(private readonly opts: RdsControllerOpts) {}

  private async getStatus(id: string): Promise<string> {
    try {
      const out = await this.opts.client.send(
        new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }),
      );
      const i = out.DBInstances?.[0];
      if (!i) throw new PermanentError(`RDS not found: ${id}`);
      return i.DBInstanceStatus ?? 'unknown';
    } catch (err) {
      throw classifyAwsError(err);
    }
  }

  async turnOff(args: { db_identifier: string }): Promise<RdsRestorationData> {
    const status = await this.getStatus(args.db_identifier);
    if (status !== 'available') {
      return { db_identifier: args.db_identifier, previous_status: status };
    }
    try {
      await this.opts.client.send(new StopDBInstanceCommand({ DBInstanceIdentifier: args.db_identifier }));
    } catch (err) {
      throw classifyAwsError(err);
    }
    return { db_identifier: args.db_identifier, previous_status: status };
  }

  async turnOn(rd: RdsRestorationData): Promise<void> {
    const status = await this.getStatus(rd.db_identifier);
    if (status === 'available' || status === 'starting') return;
    try {
      await this.opts.client.send(new StartDBInstanceCommand({ DBInstanceIdentifier: rd.db_identifier }));
    } catch (err) {
      throw classifyAwsError(err);
    }
  }

  async waitForAvailable(id: string): Promise<void> {
    const interval = this.opts.pollIntervalMs ?? 30_000;
    const maxMs = this.opts.maxPollMs ?? 10 * 60_000;
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const s = await this.getStatus(id);
      if (s === 'available') return;
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new TransientError(`RDS ${id} not available after ${maxMs}ms timeout`);
  }
}
