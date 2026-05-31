import {
  DescribeServicesCommand,
  UpdateServiceCommand,
  type ECSClient,
} from '@aws-sdk/client-ecs';
import { PermanentError, classifyAwsError } from '@demo-platform/shared';

export interface EcsRestorationData {
  cluster: string;
  service: string;
  original_desired_count: number;
}

export interface EcsControllerOpts {
  client: ECSClient;
}

export class EcsController {
  constructor(private readonly opts: EcsControllerOpts) {}

  async turnOff(args: { cluster: string; service: string }): Promise<EcsRestorationData> {
    let current: number;
    try {
      const out = await this.opts.client.send(
        new DescribeServicesCommand({ cluster: args.cluster, services: [args.service] }),
      );
      const svc = out.services?.[0];
      if (!svc) throw new PermanentError(`ECS service not found: ${args.cluster}/${args.service}`);
      current = svc.desiredCount ?? 0;
    } catch (err) {
      throw classifyAwsError(err);
    }

    if (current === 0) {
      return { cluster: args.cluster, service: args.service, original_desired_count: 0 };
    }
    try {
      await this.opts.client.send(
        new UpdateServiceCommand({
          cluster: args.cluster,
          service: args.service,
          desiredCount: 0,
        }),
      );
    } catch (err) {
      throw classifyAwsError(err);
    }
    return { cluster: args.cluster, service: args.service, original_desired_count: current };
  }

  async turnOn(rd: EcsRestorationData): Promise<void> {
    let current: number;
    try {
      const out = await this.opts.client.send(
        new DescribeServicesCommand({ cluster: rd.cluster, services: [rd.service] }),
      );
      current = out.services?.[0]?.desiredCount ?? 0;
    } catch (err) {
      throw classifyAwsError(err);
    }
    if (current === rd.original_desired_count) return;
    try {
      await this.opts.client.send(
        new UpdateServiceCommand({
          cluster: rd.cluster,
          service: rd.service,
          desiredCount: rd.original_desired_count,
        }),
      );
    } catch (err) {
      throw classifyAwsError(err);
    }
  }
}
