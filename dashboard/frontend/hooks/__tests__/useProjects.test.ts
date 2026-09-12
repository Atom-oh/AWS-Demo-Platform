import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProjects } from '@/hooks/useProjects';
import * as api from '@/lib/api';
import type { Project } from '@/lib/types';

vi.mock('@/lib/api');

const mockedApi = {
  listProjects: vi.mocked(api.listProjects),
  getProject: vi.mocked(api.getProject),
  toggleProject: vi.mocked(api.toggleProject),
  getJob: vi.mocked(api.getJob),
  scaleProject: vi.mocked(api.scaleProject),
};

async function setup() {
  mockedApi.listProjects.mockResolvedValue([]);
  mockedApi.getProject.mockResolvedValue({
    project: null as unknown as Project,
    state: { status: 'off' },
  });
  const { result } = renderHook(() => useProjects());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

describe('toggle()', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves {ok: true} on succeeded', async () => {
    const result = await setup();
    mockedApi.toggleProject.mockResolvedValue({ job_id: 'j1' });
    mockedApi.getJob.mockResolvedValue({ id: 'j1', operation: 'turn_on', status: 'succeeded', progress: {} });

    vi.useFakeTimers();
    const p = result.current.toggle('org/a', 'turn_on');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('resolves {ok: false} on failed', async () => {
    const result = await setup();
    mockedApi.toggleProject.mockResolvedValue({ job_id: 'j1' });
    mockedApi.getJob.mockResolvedValue({ id: 'j1', operation: 'turn_on', status: 'failed', progress: {} });

    vi.useFakeTimers();
    const p = result.current.toggle('org/a', 'turn_on');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: false });
  });

  it('resolves {ok: false} on partial_failure, checked as soon as observed', async () => {
    const result = await setup();
    mockedApi.toggleProject.mockResolvedValue({ job_id: 'j1' });
    mockedApi.getJob.mockResolvedValue({ id: 'j1', operation: 'turn_on', status: 'partial_failure', progress: {} });

    vi.useFakeTimers();
    const p = result.current.toggle('org/a', 'turn_on');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: false });
    expect(mockedApi.getJob).toHaveBeenCalledTimes(1);
  });

  it('resolves {ok: false} when the poll loop exhausts its timeout while still running', async () => {
    const result = await setup();
    mockedApi.toggleProject.mockResolvedValue({ job_id: 'j1' });
    mockedApi.getJob.mockResolvedValue({ id: 'j1', operation: 'turn_on', status: 'running', progress: {} });

    vi.useFakeTimers();
    const p = result.current.toggle('org/a', 'turn_on');
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(p).resolves.toEqual({ ok: false });
  });

  it('resolves {ok: false} when the initial POST rejects (network error)', async () => {
    const result = await setup();
    mockedApi.toggleProject.mockRejectedValue(new Error('network error'));

    await expect(result.current.toggle('org/a', 'turn_on')).resolves.toEqual({ ok: false });
  });

  it('resolves {ok: false} when the initial POST returns 409 (rejects, per lib/api.ts)', async () => {
    const result = await setup();
    mockedApi.toggleProject.mockRejectedValue(new Error('HTTP 409'));

    await expect(result.current.toggle('org/a', 'turn_on')).resolves.toEqual({ ok: false });
  });

  it('resolves {ok: false} when a status-poll GET rejects mid-poll', async () => {
    const result = await setup();
    mockedApi.toggleProject.mockResolvedValue({ job_id: 'j1' });
    mockedApi.getJob.mockRejectedValue(new Error('network error'));

    vi.useFakeTimers();
    const p = result.current.toggle('org/a', 'turn_on');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: false });
  });
});

describe('reload during lifecycle polling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not replace a completed toggle with a delayed transitioning snapshot', async () => {
    mockedApi.listProjects.mockResolvedValue([
      { repo: 'org/a', name: 'a', account: 'one' },
      { repo: 'org/b', name: 'b', account: 'one' },
    ]);
    let status = 'off';
    let slowReload = false;
    let release!: (value: Awaited<ReturnType<typeof api.getProject>>) => void;
    const delayed = new Promise<Awaited<ReturnType<typeof api.getProject>>>((resolve) => { release = resolve; });
    const detail = (value: string) => ({ project: null as unknown as Project, state: { status: value } });
    mockedApi.getProject.mockImplementation(async (_owner, name) =>
      name === 'b' && slowReload ? delayed : detail(status));
    mockedApi.toggleProject.mockResolvedValue({ job_id: 'toggle-a' });
    mockedApi.getJob.mockResolvedValue({ id: 'toggle-a', operation: 'turn_on', status: 'succeeded', progress: {} });
    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.useFakeTimers();
    let toggle!: Promise<{ ok: boolean }>;
    await act(async () => { toggle = result.current.toggle('org/a', 'turn_on'); });
    status = 'transitioning';
    slowReload = true;
    let reload!: Promise<void>;
    await act(async () => { reload = result.current.reload(); });
    status = 'on';
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); await toggle; });
    expect(result.current.rows.find((r) => r.repo === 'org/a')?.status).toBe('on');
    await act(async () => { release(detail('off')); await reload; });
    expect(result.current.rows.find((r) => r.repo === 'org/a')?.status).toBe('on');
  });
});

describe('turnOnAll()', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls toggle(repo, "turn_on") only for off/error projects, at most 4 concurrently', async () => {
    const result = await setup();
    const statuses: Record<string, string> = {
      'org/on-1': 'on',
      'org/off-1': 'off',
      'org/off-2': 'off',
      'org/off-3': 'off',
      'org/off-4': 'off',
      'org/off-5': 'off',
      'org/error-1': 'error',
      'org/transitioning-1': 'transitioning',
    };
    const repos = Object.keys(statuses);
    let inFlight = 0;
    let maxInFlight = 0;
    mockedApi.toggleProject.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((res) => setTimeout(res, 10));
      inFlight--;
      return { job_id: 'j' };
    });
    mockedApi.getJob.mockResolvedValue({ id: 'j', operation: 'turn_on', status: 'succeeded', progress: {} });

    vi.useFakeTimers();
    const p = result.current.turnOnAll(
      repos.map((repo) => ({ repo, status: statuses[repo] as never })),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    const results = await p;

    const expectedRepos = ['org/off-1', 'org/off-2', 'org/off-3', 'org/off-4', 'org/off-5', 'org/error-1'];
    expect(results.map((r) => r.repo).sort()).toEqual([...expectedRepos].sort());
    expect(mockedApi.toggleProject).toHaveBeenCalledTimes(expectedRepos.length);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('resolves with {repo, ok}[] built from the real per-call toggle() results', async () => {
    const result = await setup();
    mockedApi.toggleProject.mockImplementation(async (_o: string, name: string) =>
      name === 'fails' ? Promise.reject(new Error('boom')) : { job_id: 'j' },
    );
    mockedApi.getJob.mockResolvedValue({ id: 'j', operation: 'turn_on', status: 'succeeded', progress: {} });

    vi.useFakeTimers();
    const p = result.current.turnOnAll([
      { repo: 'org/ok', status: 'off' },
      { repo: 'org/fails', status: 'off' },
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    const results = await p;

    expect(results.sort((a, b) => a.repo.localeCompare(b.repo))).toEqual([
      { repo: 'org/fails', ok: false },
      { repo: 'org/ok', ok: true },
    ]);
  });
});

describe('scale()', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves {ok: true} on succeeded, reminding an ecs target only when its progress entry is done', async () => {
    const result = await setup();
    mockedApi.scaleProject.mockResolvedValue({ job_id: 'sj1' });
    mockedApi.getJob.mockResolvedValue({
      id: 'sj1',
      operation: 'scale',
      status: 'succeeded',
      progress: { 'ecs:c/s': 'done' },
    });

    const notify = vi.fn();
    vi.useFakeTimers();
    const p = result.current.scale('org/a', [{ stepKey: 'ecs:c/s', desiredCount: 4 }], notify);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: true });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('ecs:c/s'), undefined);
  });

  it('resolves {ok: false} on failed', async () => {
    const result = await setup();
    mockedApi.scaleProject.mockResolvedValue({ job_id: 'sj2' });
    mockedApi.getJob.mockResolvedValue({
      id: 'sj2',
      operation: 'scale',
      status: 'failed',
      progress: {},
    });

    vi.useFakeTimers();
    const p = result.current.scale('org/a', [{ stepKey: 'ecs:c/s', desiredCount: 4 }]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: false });
  });

  it('resolves {ok: false} on partial_failure', async () => {
    const result = await setup();
    mockedApi.scaleProject.mockResolvedValue({ job_id: 'sj3' });
    mockedApi.getJob.mockResolvedValue({
      id: 'sj3',
      operation: 'scale',
      status: 'partial_failure',
      progress: {},
    });

    vi.useFakeTimers();
    const p = result.current.scale('org/a', [{ stepKey: 'ecs:c/s', desiredCount: 4 }]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: false });
  });

  it('resolves {ok: false} when the initial POST rejects (network error or 409)', async () => {
    const result = await setup();
    mockedApi.scaleProject.mockRejectedValue(new Error('HTTP 409'));
    await expect(
      result.current.scale('org/a', [{ stepKey: 'ecs:c/s', desiredCount: 4 }]),
    ).resolves.toEqual({ ok: false });
  });

  it('resolves {ok: false} when a status-poll GET rejects mid-poll', async () => {
    const result = await setup();
    mockedApi.scaleProject.mockResolvedValue({ job_id: 'sj4' });
    mockedApi.getJob.mockRejectedValue(new Error('network error'));

    vi.useFakeTimers();
    const p = result.current.scale('org/a', [{ stepKey: 'ecs:c/s', desiredCount: 4 }]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: false });
  });

  it('resolves {ok: false} when the poll loop exhausts its timeout while still running', async () => {
    const result = await setup();
    mockedApi.scaleProject.mockResolvedValue({ job_id: 'sj5' });
    mockedApi.getJob.mockResolvedValue({
      id: 'sj5',
      operation: 'scale',
      status: 'running',
      progress: {},
    });

    vi.useFakeTimers();
    const p = result.current.scale('org/a', [{ stepKey: 'ecs:c/s', desiredCount: 4 }]);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(p).resolves.toEqual({ ok: false });
  });

  it('does NOT remind an ecs target whose progress entry is failed: (accepted narrow ambiguity)', async () => {
    const result = await setup();
    mockedApi.scaleProject.mockResolvedValue({ job_id: 'sj6' });
    mockedApi.getJob.mockResolvedValue({
      id: 'sj6',
      operation: 'scale',
      status: 'failed',
      progress: { 'ecs:c/s': 'failed: timeout' },
    });

    const notify = vi.fn();
    vi.useFakeTimers();
    const p = result.current.scale('org/a', [{ stepKey: 'ecs:c/s', desiredCount: 4 }], notify);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    const reminded = notify.mock.calls.some((c) => String(c[0]).includes('ecs:c/s'));
    expect(reminded).toBe(false);
  });

  it('reminds an argocd-app target on any non-idle progress entry (done OR failed:), not just done', async () => {
    const result = await setup();
    mockedApi.scaleProject.mockResolvedValue({ job_id: 'sj7' });
    mockedApi.getJob.mockResolvedValue({
      id: 'sj7',
      operation: 'scale',
      status: 'failed',
      progress: { 'argocd-app:app-a': 'failed: sibling handle failed' },
    });

    const notify = vi.fn();
    vi.useFakeTimers();
    const p = result.current.scale('org/a', [{ stepKey: 'argocd-app:app-a', replicas: 5 }], notify);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    const reminded = notify.mock.calls.some((c) => String(c[0]).includes('argocd-app:app-a'));
    expect(reminded).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('저장된 기준이 없으면'), true);
  });

  it('does not remind a target with no progress entry at all (job-level abort)', async () => {
    const result = await setup();
    mockedApi.scaleProject.mockResolvedValue({ job_id: 'sj8' });
    mockedApi.getJob.mockResolvedValue({
      id: 'sj8',
      operation: 'scale',
      status: 'failed',
      progress: {},
    });

    const notify = vi.fn();
    vi.useFakeTimers();
    const p = result.current.scale('org/a', [{ stepKey: 'argocd-app:app-a', replicas: 5 }], notify);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    const reminded = notify.mock.calls.some((c) => String(c[0]).includes('argocd-app:app-a'));
    expect(reminded).toBe(false);
  });
});
