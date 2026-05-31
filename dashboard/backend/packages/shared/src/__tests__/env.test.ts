import { describe, it, expect } from 'vitest';
import { loadCommonEnv, loadApiEnv, loadWorkerEnv } from '../env.js';

const validBase = {
  NODE_ENV: 'development',
  AWS_REGION: 'ap-northeast-2',
  DDB_TABLE_STATE: 'demo-platform-state-dev',
  DDB_TABLE_JOBS: 'demo-platform-jobs-dev',
  DDB_TABLE_HISTORY: 'demo-platform-history-dev',
  SQS_QUEUE_URL: 'http://localhost:4566/000000000000/demo-platform-jobs-dev',
  PROJECTS_DIR: './projects',
  ACCOUNTS_FILE: './accounts.yaml',
  GITHUB_PAT: 'ghp_xxxx',
  ARGOCD_BASE_URL: 'https://argocd.atomai.click',
  ARGOCD_ADMIN_TOKEN: 'tok',
};

describe('loadCommonEnv', () => {
  it('parses a valid env block', () => {
    const env = loadCommonEnv(validBase);
    expect(env.AWS_REGION).toBe('ap-northeast-2');
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws when required keys are missing', () => {
    expect(() => loadCommonEnv({ ...validBase, AWS_REGION: undefined } as unknown as Record<string, string>)).toThrow();
  });
});

describe('loadApiEnv', () => {
  it('extends common with PORT, ADMIN_USERNAMES', () => {
    const env = loadApiEnv({
      ...validBase,
      PORT: '8080',
      ADMIN_USERNAMES: 'atomoh,other',
      COGNITO_USER_POOL_ID: 'ap-northeast-2_xxx',
      COGNITO_APP_CLIENT_ID: 'abc',
    });
    expect(env.PORT).toBe(8080);
    expect(env.ADMIN_USERNAMES).toEqual(['atomoh', 'other']);
  });
});

describe('loadWorkerEnv', () => {
  it('extends common with WORKER_POLL_WAIT_SECONDS default', () => {
    const env = loadWorkerEnv(validBase);
    expect(env.WORKER_POLL_WAIT_SECONDS).toBe(20);
  });

  it('respects explicit WORKER_POLL_WAIT_SECONDS', () => {
    const env = loadWorkerEnv({ ...validBase, WORKER_POLL_WAIT_SECONDS: '10' });
    expect(env.WORKER_POLL_WAIT_SECONDS).toBe(10);
  });
});
