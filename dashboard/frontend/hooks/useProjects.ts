'use client';
import { useCallback, useEffect, useState } from 'react';
import { listProjects, getProject, toggleProject, getJob, scaleProject } from '@/lib/api';
import type { ProjectRow, Status, ScaleTarget } from '@/lib/types';

type Notify = (msg: string, err?: boolean) => void;

// Fixed, not a tunable — matches the spec's "4 at a time" concurrency limit.
const TURN_ON_ALL_CONCURRENCY = 4;

const ECS_SCALE_REMINDER = 'this becomes the new turn_off restore point';
const ARGOCD_SCALE_REMINDER =
  "if this application contains an HPA, this pins its autoscaling range to a fixed count, which cannot be recovered through this tool afterward, even by scaling back down";

export function useProjects() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshOne = useCallback(async (repo: string) => {
    const [owner, name] = repo.split('/');
    try {
      const d = await getProject(owner, name);
      setRows((rs) =>
        rs.map((r) =>
          r.repo === repo
            ? { ...r, project: d.project, status: (d.state?.status as Status) ?? 'unknown' }
            : r,
        ),
      );
    } catch {
      /* leave row as-is */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listProjects();
      const detailed = await Promise.all(
        list.map(async (it): Promise<ProjectRow> => {
          const [owner, name] = it.repo.split('/');
          try {
            const d = await getProject(owner, name);
            return { ...it, project: d.project, status: (d.state?.status as Status) ?? 'unknown' };
          } catch {
            return { ...it, project: null, status: 'unknown' };
          }
        }),
      );
      setRows(detailed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

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
    [refreshOne],
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
  // irreversibly pinned its HPA before a sibling handle failed, so a failed:
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
        notify?.(`${repo} scale failed: ${(e as Error).message}`, true);
        return { ok: false };
      }

      const reminders: string[] = [];
      for (const t of targets) {
        const entry = progress[t.stepKey];
        if (t.desiredCount !== undefined) {
          if (entry === 'done') reminders.push(`${t.stepKey}: ${ECS_SCALE_REMINDER}`);
        } else if (entry !== undefined) {
          reminders.push(`${t.stepKey}: ${ARGOCD_SCALE_REMINDER}`);
        }
      }
      const suffix = reminders.length > 0 ? ` — ${reminders.join('; ')}` : '';
      notify?.(
        `${repo} scale ${ok ? 'succeeded' : 'failed or incomplete'}${suffix}`,
        ok ? undefined : true,
      );
      return { ok };
    },
    [],
  );

  return { rows, loading, error, reload: load, toggle, turnOnAll, scale };
}
