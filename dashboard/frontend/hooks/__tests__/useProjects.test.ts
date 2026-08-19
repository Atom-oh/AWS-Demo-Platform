import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProjects } from '@/hooks/useProjects';
import * as api from '@/lib/api';
import type { Project } from '@/lib/types';

vi.mock('@/lib/api');

const mockedApi = {
  listProjects: vi.mocked(api.listProjects),
  getProject: vi.mocked(api.getProject),
  toggleProject: vi.mocked(api.toggleProject),
  getJob: vi.mocked(api.getJob),
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
