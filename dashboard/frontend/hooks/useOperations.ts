'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectRow, Status } from '@/lib/types';

export type Operation = 'turn_on' | 'turn_off';
export interface OperationTarget { repo: string; name: string }
export interface OperationResult extends OperationTarget {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  message?: string;
  retryNote?: string;
}
type Toggle = (repo: string, op: Operation, notify?: (message: string, error?: boolean) => void) => Promise<{ ok: boolean }>;
type Task = (notify: (message: string, error?: boolean) => void) => Promise<{ ok: boolean }>;
const CONCURRENCY = 4;

export function eligible(status: Status, op: Operation) {
  return op === 'turn_on' ? status === 'off' || status === 'error' : status === 'on';
}

export function useOperations(rows: ProjectRow[], toggle: Toggle) {
  const currentRows = useRef(rows);
  currentRows.current = rows;
  const active = useRef(new Set<string>());
  const batchLock = useRef(false);
  const alive = useRef(true);
  const [activeRepos, setActiveRepos] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [operation, setOperation] = useState<Operation>('turn_on');
  const [results, setResults] = useState<OperationResult[]>([]);
  const resultsRef = useRef<OperationResult[]>([]);
  const operationRef = useRef<Operation>('turn_on');

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const publish = useCallback((items: OperationResult[]) => {
    resultsRef.current = items;
    if (alive.current) setResults(items);
  }, []);

  const withLock = useCallback(async (repo: string, task: Task) => {
    if (!alive.current || active.current.has(repo) || active.current.size >= CONCURRENCY) {
      return { ok: false, skipped: true, message: '다른 작업이 진행 중입니다.' };
    }
    active.current.add(repo);
    if (alive.current) setActiveRepos(new Set(active.current));
    let message = '';
    try {
      const outcome = await task((text) => { message = text; });
      return { ...outcome, skipped: false, message: message || (outcome.ok ? '완료' : '실패 또는 결과 미확인') };
    } catch (error) {
      return { ok: false, skipped: false, message: (error as Error).message };
    } finally {
      active.current.delete(repo);
      if (alive.current) setActiveRepos(new Set(active.current));
    }
  }, []);

  const execute = useCallback((repo: string, op: Operation) => {
    const row = currentRows.current.find((r) => r.repo === repo);
    if (!row || !eligible(row.status, op)) {
      return Promise.resolve({ ok: false, skipped: true, message: '현재 상태에서 실행할 수 없어 제외했습니다.' });
    }
    return withLock(repo, (notify) => toggle(repo, op, notify));
  }, [toggle, withLock]);

  const runSingle = useCallback((repo: string, op: Operation) => {
    if (batchLock.current) {
      return Promise.resolve({ ok: false, skipped: true, message: '일괄 작업이 진행 중입니다.' });
    }
    return execute(repo, op);
  }, [execute]);

  const runScale = useCallback((repo: string, task: Task) => {
    if (batchLock.current || currentRows.current.find((r) => r.repo === repo)?.status !== 'on') {
      return Promise.resolve({ ok: false, skipped: true, message: '현재 상태에서 수량을 변경할 수 없습니다.' });
    }
    return withLock(repo, task);
  }, [withLock]);

  const runBatch = useCallback(async (op: Operation, requested: OperationTarget[], retrying = false) => {
    if (batchLock.current || active.current.size > 0 || !alive.current) return;
    if (retrying && op !== operationRef.current) return;
    const previous = resultsRef.current;
    const previousByRepo = new Map(previous.map((item) => [item.repo, item]));
    // Freeze names and membership; later filter/selection changes never widen a run.
    const targets = [...new Map(requested.map((t) => [t.repo, { ...t }])).values()]
      .filter((target) => !retrying || previousByRepo.get(target.repo)?.status === 'failed');
    if (!targets.length) return;
    batchLock.current = true;
    operationRef.current = op;
    setOperation(op);
    setRunning(true);
    const targetIds = new Set(targets.map((target) => target.repo));
    publish(retrying
      ? previous.map((item) => targetIds.has(item.repo) ? { ...item, status: 'queued', retryNote: undefined } : item)
      : targets.map((t) => ({ ...t, status: 'queued' })));
    const update = (repo: string, change: Partial<OperationResult>) => {
      if (alive.current) publish(resultsRef.current.map((item) => item.repo === repo ? { ...item, ...change } : item));
    };
    let cursor = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
        while (alive.current && cursor < targets.length) {
          const target = targets[cursor++];
          update(target.repo, { status: 'running' });
          const result = await execute(target.repo, op);
          update(target.repo, retrying && result.skipped ? {
            status: 'failed',
            message: previousByRepo.get(target.repo)?.message,
            retryNote: result.message,
          } : {
            status: result.ok ? 'succeeded' : result.skipped ? 'skipped' : 'failed',
            message: result.message,
            retryNote: undefined,
          });
        }
      }));
    } finally {
      batchLock.current = false;
      if (alive.current) setRunning(false);
    }
  }, [execute, publish]);

  const clear = useCallback(() => {
    if (!batchLock.current) publish([]);
  }, [publish]);

  return { activeRepos, running, operation, results, runBatch, runSingle, runScale, clear };
}
