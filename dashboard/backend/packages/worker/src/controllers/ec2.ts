import {
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  type EC2Client,
} from '@aws-sdk/client-ec2';
import { classifyAwsError } from '@demo-platform/shared';

export interface Ec2InstanceState {
  instance_id: string;
  previous_state: string;
}

export interface Ec2RestorationData {
  instances: Ec2InstanceState[];
}

export interface Ec2ControllerOpts {
  client: EC2Client;
}

export class Ec2Controller {
  constructor(private readonly opts: Ec2ControllerOpts) {}

  private async describe(ids: string[]): Promise<Ec2InstanceState[]> {
    try {
      const out = await this.opts.client.send(
        new DescribeInstancesCommand({ InstanceIds: ids }),
      );
      const results: Ec2InstanceState[] = [];
      for (const r of out.Reservations ?? []) {
        for (const i of r.Instances ?? []) {
          if (i.InstanceId) {
            results.push({
              instance_id: i.InstanceId,
              previous_state: i.State?.Name ?? 'unknown',
            });
          }
        }
      }
      return results;
    } catch (err) {
      throw classifyAwsError(err);
    }
  }

  async turnOff(args: { instance_ids: string[] }): Promise<Ec2RestorationData> {
    const states = await this.describe(args.instance_ids);
    const toStop = states.filter((s) => s.previous_state === 'running').map((s) => s.instance_id);
    if (toStop.length > 0) {
      try {
        await this.opts.client.send(new StopInstancesCommand({ InstanceIds: toStop }));
      } catch (err) {
        throw classifyAwsError(err);
      }
    }
    return { instances: states };
  }

  async turnOn(rd: Ec2RestorationData): Promise<void> {
    const toStart = rd.instances.filter((s) => s.previous_state === 'running').map((s) => s.instance_id);
    if (toStart.length === 0) return;
    try {
      await this.opts.client.send(new StartInstancesCommand({ InstanceIds: toStart }));
    } catch (err) {
      throw classifyAwsError(err);
    }
  }
}
