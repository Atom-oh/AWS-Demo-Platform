import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { STSClient } from '@aws-sdk/client-sts';
import { ECSClient } from '@aws-sdk/client-ecs';
import { EC2Client } from '@aws-sdk/client-ec2';
import { RDSClient } from '@aws-sdk/client-rds';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import {
  createLogger,
  loadWorkerEnv,
  makeClient,
  makeClientWithCreds,
  createAssumeRoleCache,
  StateClient,
  JobsClient,
  HistoryClient,
  ArgocdClient,
  GithubClient,
  ProjectSchema,
  AccountsFileSchema,
  type Project,
  type Account,
} from '@demo-platform/shared';
import { EcsController } from './controllers/ecs.js';
import { Ec2Controller } from './controllers/ec2.js';
import { RdsController } from './controllers/rds.js';
import { ArgocdController } from './controllers/argocd.js';
import { pollForever, sweepRunningJobs } from './poll-loop.js';
import { startDiscoveryCron } from './discoverer.js';

async function loadProjects(dir: string): Promise<Record<string, Project>> {
  const entries = await fs.readdir(dir);
  const out: Record<string, Project> = {};
  for (const e of entries) {
    if (!e.endsWith('.yaml') && !e.endsWith('.yml')) continue;
    if (e === 'CLAUDE.md') continue;
    const raw = await fs.readFile(path.join(dir, e), 'utf8');
    const parsed = ProjectSchema.parse(yaml.parse(raw));
    out[parsed.github.repo] = parsed;
  }
  return out;
}

async function loadAccounts(file: string): Promise<Record<string, Account>> {
  const raw = await fs.readFile(file, 'utf8');
  const parsed = AccountsFileSchema.parse(yaml.parse(raw));
  return Object.fromEntries(parsed.accounts.map((a) => [a.name, a]));
}

async function fetchSecret(client: SecretsManagerClient, id: string): Promise<string> {
  const out = await client.send(new GetSecretValueCommand({ SecretId: id }));
  if (!out.SecretString) throw new Error(`secret ${id} has no SecretString`);
  return out.SecretString;
}

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const logger = createLogger({ name: 'worker', level: 'info' });
  logger.info({ region: env.AWS_REGION }, 'worker starting');

  const ddbRaw = makeClient(DynamoDBClient, { region: env.AWS_REGION });
  const doc = DynamoDBDocumentClient.from(ddbRaw);
  const sqs = makeClient(SQSClient, { region: env.AWS_REGION });
  const sts = makeClient(STSClient, { region: env.AWS_REGION });
  const sm = makeClient(SecretsManagerClient, { region: env.AWS_REGION });

  const stateClient = new StateClient({ doc, tableName: env.DDB_TABLE_STATE });
  const jobsClient = new JobsClient({ doc, tableName: env.DDB_TABLE_JOBS });
  const historyClient = new HistoryClient({ doc, tableName: env.DDB_TABLE_HISTORY });
  const ddb = { state: stateClient, jobs: jobsClient, history: historyClient };

  const argoClient = new ArgocdClient({
    baseUrl: env.ARGOCD_BASE_URL,
    adminToken: env.ARGOCD_ADMIN_TOKEN,
    namespace: 'placeholder', // resolved per-project via workload_selector
  });

  const githubClient = new GithubClient({ pat: env.GITHUB_PAT, org: 'Atom-oh' });

  const assumeCache = createAssumeRoleCache({ stsClient: sts });

  const projects = await loadProjects(env.PROJECTS_DIR);
  const accounts = await loadAccounts(env.ACCOUNTS_FILE);
  logger.info({ projects: Object.keys(projects).length, accounts: Object.keys(accounts).length }, 'config loaded');

  // Startup sweep
  await sweepRunningJobs({ sqsClient: sqs, queueUrl: env.SQS_QUEUE_URL, jobsClient, logger });

  // GitHub discoverer
  startDiscoveryCron({ github: githubClient, doc, tableName: env.DDB_TABLE_STATE, logger });

  const buildControllers = async (account: Account) => {
    const externalId = await fetchSecret(sm, account.roles.operator.external_id_secret);
    const creds = await assumeCache.assume({
      roleArn: account.roles.operator.arn,
      externalId,
      sessionName: 'demo-platform-worker',
    });
    const ecsClient = makeClientWithCreds(ECSClient, {
      region: account.region,
      credentials: creds,
    });
    const ec2Client = makeClientWithCreds(EC2Client, {
      region: account.region,
      credentials: creds,
    });
    const rdsClient = makeClientWithCreds(RDSClient, {
      region: account.region,
      credentials: creds,
    });
    return {
      ecs: new EcsController({ client: ecsClient }),
      ec2: new Ec2Controller({ client: ec2Client }),
      rds: new RdsController({ client: rdsClient }),
      argocd: new ArgocdController({ client: argoClient }),
    };
  };

  await pollForever({
    sqsClient: sqs,
    queueUrl: env.SQS_QUEUE_URL,
    waitSeconds: env.WORKER_POLL_WAIT_SECONDS,
    logger,
    projectByRepo: projects,
    accountsByName: accounts,
    ddb,
    buildControllers,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('worker fatal error', err);
    process.exit(1);
  });
}
