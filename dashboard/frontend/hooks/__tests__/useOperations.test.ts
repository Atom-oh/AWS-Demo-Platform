import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useOperations } from '@/hooks/useOperations';
import type { ProjectRow } from '@/lib/types';

const rows: ProjectRow[] = Array.from({ length: 6 }, (_, i) => ({
  repo: `org/${i}`, name: `Project ${i}`, account: 'one', project: null, status: 'off',
}));
const targets = rows.map(({ repo, name }) => ({ repo, name }));

describe('operation dispatch', () => {
  it('runs at most four at once, advances as each finishes, and keeps failures visible', async () => {
    const finish = new Map<string, (value: { ok: boolean }) => void>();
    const toggle = vi.fn((repo: string) => new Promise<{ ok: boolean }>((resolve) => { finish.set(repo, resolve); }));
    const { result } = renderHook(() => useOperations(rows, toggle));
    let batch!: Promise<void>;
    act(() => { batch = result.current.runBatch('turn_on', targets); });
    expect(toggle).toHaveBeenCalledTimes(4);
    await act(async () => { finish.get('org/1')!({ ok: false }); });
    expect(toggle).toHaveBeenCalledTimes(5);
    expect(result.current.results.find((r) => r.repo === 'org/1')?.status).toBe('failed');
    await act(async () => { finish.get('org/0')!({ ok: true }); });
    expect(toggle).toHaveBeenCalledTimes(6);
    await act(async () => {
      for (const repo of ['org/2', 'org/3', 'org/4', 'org/5']) finish.get(repo)!({ ok: true });
      await batch;
    });
    expect(result.current.running).toBe(false);
    expect(result.current.results.filter((r) => r.status === 'succeeded')).toHaveLength(5);
    expect(result.current.results.filter((r) => r.status === 'failed')).toHaveLength(1);
  });

  it('blocks individual actions during a batch and rechecks queued targets before dispatch', async () => {
    const release: ((value: { ok: boolean }) => void)[] = [];
    const toggle = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { release.push(resolve); }));
    const { result, rerender } = renderHook(({ current }) => useOperations(current, toggle), { initialProps: { current: rows } });
    let batch!: Promise<void>;
    act(() => { batch = result.current.runBatch('turn_on', targets.slice(0, 5)); });
    await act(async () => { await result.current.runSingle('org/5', 'turn_on'); });
    expect(toggle).toHaveBeenCalledTimes(4);
    rerender({ current: rows.map((r) => r.repo === 'org/4' ? { ...r, status: 'on' } : r) });
    await act(async () => { release.forEach((done) => done({ ok: true })); await batch; });
    expect(toggle).toHaveBeenCalledTimes(4);
    expect(result.current.results[4].status).toBe('skipped');
  });

  it('deduplicates a selected snapshot and sends turn_off only for on projects', async () => {
    const toggle = vi.fn(async () => ({ ok: true }));
    const current: ProjectRow[] = [{ ...rows[0], status: 'on' }, rows[1]];
    const { result } = renderHook(() => useOperations(current, toggle));
    await act(async () => { await result.current.runBatch('turn_off', [targets[0], targets[0], targets[1]]); });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle.mock.calls[0].slice(0, 2)).toEqual(['org/0', 'turn_off']);
    expect(result.current.results.map((r) => r.status)).toEqual(['succeeded', 'skipped']);
  });

  it('does not start queued projects after the screen unmounts', async () => {
    const finish: ((value: { ok: boolean }) => void)[] = [];
    const toggle = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { finish.push(resolve); }));
    const { result, unmount } = renderHook(() => useOperations(rows, toggle));
    let batch!: Promise<void>;
    act(() => { batch = result.current.runBatch('turn_on', targets); });
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(4));
    unmount();
    finish.forEach((resolve) => resolve({ ok: true }));
    await batch;
    await result.current.runSingle('org/5', 'turn_on');
    expect(toggle).toHaveBeenCalledTimes(4);
  });

  it('keeps a scale lock after its drawer closes and prevents conflicting lifecycle work', async () => {
    let finish!: (value: { ok: boolean }) => void;
    const task = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { finish = resolve; }));
    const toggle = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() => useOperations([{ ...rows[0], status: 'on' }], toggle));
    let scale!: ReturnType<typeof result.current.runScale>;
    act(() => { scale = result.current.runScale('org/0', task); });
    await act(async () => {
      await result.current.runSingle('org/0', 'turn_off');
      await result.current.runBatch('turn_off', [targets[0]]);
    });
    expect(toggle).not.toHaveBeenCalled();
    expect(result.current.activeRepos.has('org/0')).toBe(true);
    await act(async () => { finish({ ok: true }); await scale; });
    expect(result.current.activeRepos.size).toBe(0);
  });

  it('preserves a failed shutdown when its off state prevents an actual retry', async () => {
    const toggle = vi.fn(async (_repo: string, _op: string, notify?: (message: string) => void) => {
      notify?.('Partial shutdown: database operation failed');
      return { ok: false };
    });
    const { result, rerender } = renderHook(({ current }) => useOperations(current, toggle), {
      initialProps: { current: [{ ...rows[0], status: 'on' as const }] as ProjectRow[] },
    });
    await act(async () => { await result.current.runBatch('turn_off', [targets[0]]); });
    rerender({ current: [{ ...rows[0], status: 'off' }] });
    await act(async () => { await result.current.runBatch('turn_off', [targets[0]], true); });
    expect(toggle).toHaveBeenCalledOnce();
    expect(result.current.results[0].status).toBe('failed');
    expect(result.current.results[0].message).toContain('database operation failed');
    expect(result.current.results[0].retryNote).toBeTruthy();
  });
});
