import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type {
  Project,
  Account,
  Logger,
  JobsClient,
} from '@demo-platform/shared';
import type { Controllers, DDB } from './job-runner.js';
import { runJob as defaultRunJob } from './job-runner.js';

interface MessageBody {
  jobId: string;
  repo: string;
  operation: 'turn_off' | 'turn_on';
}

export interface PollContext {
  sqsClient: SQSClient;
  queueUrl: string;
  waitSeconds: number;
  logger: Logger;
  projectByRepo: Record<string, Project>;
  accountsByName: Record<string, Account>;
  ddb: DDB;
  buildControllers: (account: Account) => Promise<Controllers>;
  runJob?: typeof defaultRunJob;
}

export async function runOnce(ctx: PollContext): Promise<boolean> {
  const recv = await ctx.sqsClient.send(
    new ReceiveMessageCommand({
      QueueUrl: ctx.queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: ctx.waitSeconds,
      VisibilityTimeout: 300,
    }),
  );
  const msg = recv.Messages?.[0];
  if (!msg?.Body) return false;

  let body: MessageBody;
  try {
    body = JSON.parse(msg.Body) as MessageBody;
  } catch (err) {
    ctx.logger.error({ err, raw: msg.Body }, 'sqs body parse failed; deleting');
    await ctx.sqsClient.send(
      new DeleteMessageCommand({ QueueUrl: ctx.queueUrl, ReceiptHandle: msg.ReceiptHandle! }),
    );
    return true;
  }

  const project = ctx.projectByRepo[body.repo];
  if (!project) {
    ctx.logger.error({ repo: body.repo }, 'unknown project; deleting message');
    await ctx.sqsClient.send(
      new DeleteMessageCommand({ QueueUrl: ctx.queueUrl, ReceiptHandle: msg.ReceiptHandle! }),
    );
    return true;
  }

  const account = ctx.accountsByName[project.account];
  if (!account) {
    ctx.logger.error({ account: project.account }, 'unknown account; deleting message');
    await ctx.sqsClient.send(
      new DeleteMessageCommand({ QueueUrl: ctx.queueUrl, ReceiptHandle: msg.ReceiptHandle! }),
    );
    return true;
  }

  try {
    const controllers = await ctx.buildControllers(account);
    const runner = ctx.runJob ?? defaultRunJob;
    await runner({
      job: { id: body.jobId, operation: body.operation, repo: body.repo, actor: 'system' },
      project,
      account: account.name,
      controllers,
      ddb: ctx.ddb,
      logger: ctx.logger.child
        ? ctx.logger.child({ jobId: body.jobId, repo: body.repo })
        : ctx.logger,
    });
    await ctx.sqsClient.send(
      new DeleteMessageCommand({ QueueUrl: ctx.queueUrl, ReceiptHandle: msg.ReceiptHandle! }),
    );
  } catch (err) {
    ctx.logger.error({ err, jobId: body.jobId }, 'job processing failed; visibility timeout will redeliver');
    // do NOT delete: SQS redelivers after VisibilityTimeout
  }
  return true;
}

export async function pollForever(ctx: PollContext, abortSignal?: AbortSignal): Promise<void> {
  while (!abortSignal?.aborted) {
    try {
      await runOnce(ctx);
    } catch (err) {
      ctx.logger.error({ err }, 'poll iteration error; backing off 5s');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export interface SweepArgs {
  sqsClient: SQSClient;
  queueUrl: string;
  jobsClient: JobsClient;
  logger: Logger;
}

export async function sweepRunningJobs(args: SweepArgs): Promise<void> {
  const running = await args.jobsClient.listRunning();
  args.logger.info({ count: running.length }, 'startup sweep: found running jobs');
  for (const job of running) {
    const jobId = job.pk.replace(/^job#/, '');
    const repo = job.gsi1pk.replace(/^project#/, '');
    await args.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: args.queueUrl,
        MessageBody: JSON.stringify({ jobId, repo, operation: job.operation }),
      }),
    );
  }
}
