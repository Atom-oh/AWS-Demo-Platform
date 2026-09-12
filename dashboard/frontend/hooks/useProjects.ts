'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listProjects, getProject, toggleProject, getJob, scaleProject } from '@/lib/api';
import type { ProjectRow, Status, ScaleTarget } from '@/lib/types';
import { ECS_SCALE_NOTE, HPA_SCALE_NOTE, HPA_SCALE_WARNING } from '@/lib/presentation';

type Notify = (msg: string, err?: boolean) => void;

// Fixed, not a tunable — matches the spec's "4 at a time" concurrency limit.
const TURN_ON_ALL_CONCURRENCY = 4;

export function useProjects() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rowRequestIds = useRef<Record<string, number>>({});
  const loadSequence = useRef(0);

  const nextRowRequest = useCallback((repo: string) => {
    const id = (rowRequestIds.current[repo] ?? 0) + 1;
    rowRequestIds.current[repo] = id;
    return id;
  }, []);

  // Both fetch paths share request-start ordering, independent of response timing.
  const readProject = useCallback(async (repo: string) => {
    const requestId = nextRowRequest(repo);
    const [owner, name] = repo.split('/');
    try {
      return { requestId, detail: await getProject(owner, name) };
    } catch {
      return { requestId, detail: null };
    }
  }, [nextRowRequest]);

  const refreshOne = useCallback(async (repo: string) => {
    const { requestId, detail } = await readProject(repo);
    if (!detail) return;
    setRows((rs) => {
      if (rowRequestIds.current[repo] !== requestId) return rs;
      return rs.map((r) =>
          r.repo === repo
            ? { ...r, project: detail.project, status: (detail.state?.status as Status) ?? 'unknown' }
            : r,
      );
    });
  }, [readProject]);

  const load = useCallback(async () => {
    const loadId = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const list = await listProjects();
      if (loadId !== loadSequence.current) return;
      const detailed = await Promise.all(
        list.map(async (it) => {
          const { requestId, detail } = await readProject(it.repo);
          const row: ProjectRow = {
            ...it, project: detail?.project ?? null,
            status: (detail?.state?.status as Status) ?? 'unknown',
          };
          return { requestId, row };
        }),
      );
      setRows((current) => {
        if (loadId !== loadSequence.current) return current;
        const byRepo = new Map(current.map((row) => [row.repo, row]));
        return detailed.map(({ requestId, row }) =>
          rowRequestIds.current[row.repo] !== requestId
            ? byRepo.get(row.repo) ?? row
            : row);
      });
    } catch (e) {
      if (loadId === loadSequence.current) setError((e as Error).message);
    } finally {
      if (loadId === loadSequence.current) setLoading(false);
    }
  }, [readProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (
      repo: string,
      op: 'turn_on' | 'turn_off',
      notify?: Notify,
    ): Promise<{ ok: boolean }> => {
      const [owner, name] = repo.split('/');
      nextRowRequest(repo);
      setRows((rs) => rs.map((r) => (r.repo === repo ? { ...r, status: 'transitioning' } : r)));
      let ok = false;
      try {
        const { job_id } = await toggleProject(owner, name, op);
        for (let i = 0; i < 60; i++) {
          await new Promise((res) => setTimeout(res, 1000));
          const job = await getJob(job_id);
          if (job.status === 'succeeded') {
            ok = true;
            notify?.(`${repo} → ${op === 'turn_on' ? 'ON' : 'OFF'} 완료`);
            break;
          }
          if (job.status === 'failed' || job.status === 'partial_failure') {
            notify?.(`${repo} 실패: ${job.error ?? ''}`, true);
            break;
          }
        }
      } catch (e) {
        notify?.(`${repo} 토글 실패: ${(e as Error).message}`, true);
      }
      await refreshOne(repo);
      return { ok };
    },
    [nextRowRequest, refreshOne],
  );

  const turnOnAll = useCallback(
    async (
      candidates: { repo: string; status: Status }[],
    ): Promise<{ repo: string; ok: boolean }[]> => {
      const targets = candidates.filter((c) => c.status === 'off' || c.status === 'error');
      const results: { repo: string; ok: boolean }[] = [];
      for (let i = 0; i < targets.length; i += TURN_ON_ALL_CONCURRENCY) {
        const chunk = targets.slice(i, i + TURN_ON_ALL_CONCURRENCY);
        const chunkResults = await Promise.all(
          chunk.map(async (c) => ({ repo: c.repo, ok: (await toggle(c.repo, 'turn_on')).ok })),
        );
        results.push(...chunkResults);
      }
      return results;
    },
    [toggle],
  );

  // Same POST → job_id → 1s-interval poll pattern as toggle(), and the same
  // never-rejects contract: resolves {ok:true} on succeeded, {ok:false} on
  // failed/partial_failure/POST-or-poll error/timeout. The reminder is scoped
  // using the job's per-stepKey progress map, not the coarser job-level status:
  // for an ecs target, only when its entry is 'done'; for an argocd-app target,
  // on any non-idle entry ('done' OR a 'failed:' one) — HPA-first patch
  // ordering means a target that ultimately reports failed may still have
  // pinned its HPA before a sibling handle failed. That failure may prevent
  // baseline persistence, so a failed:
  // entry can't be treated as "nothing happened" the way it can for ecs.
  const scale = useCallback(
    async (
      repo: string,
      targets: ScaleTarget[],
      notify?: Notify,
    ): Promise<{ ok: boolean }> => {
      const [owner, name] = repo.split('/');
      let ok = false;
      let progress: Record<string, string> = {};
      try {
        const { job_id } = await scaleProject(owner, name, targets);
        for (let i = 0; i < 60; i++) {
          await new Promise((res) => setTimeout(res, 1000));
          const job = await getJob(job_id);
          progress = job.progress;
          if (job.status === 'succeeded') {
            ok = true;
            break;
          }
          if (job.status === 'failed' || job.status === 'partial_failure') {
            break;
          }
        }
      } catch (e) {
        notify?.(`${repo} 수량 변경 실패: ${(e as Error).message}`, true);
        return { ok: false };
      }

      const reminders: string[] = [];
      for (const t of targets) {
        const entry = progress[t.stepKey];
        if (t.desiredCount !== undefined) {
          if (entry === 'done') reminders.push(`${t.stepKey}: ${ECS_SCALE_NOTE}`);
        } else if (entry !== undefined) {
          reminders.push(`${t.stepKey}: ${entry === 'done' ? HPA_SCALE_NOTE : HPA_SCALE_WARNING}`);
        }
      }
      const suffix = reminders.length > 0 ? ` — ${reminders.join('; ')}` : '';
      notify?.(
        `${repo} 수량 변경 ${ok ? '완료' : '실패 또는 미완료'}${suffix}`,
        ok ? undefined : true,
      );
      return { ok };
    },
    [],
  );

  return { rows, loading, error, reload: load, toggle, turnOnAll, scale };
}
