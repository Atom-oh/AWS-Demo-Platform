'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectRow, HistoryRecord, ResourceRef } from '@/lib/types';
import { getHistory } from '@/lib/api';

const TOGGLEABLE = new Set(['ecs', 'ec2', 'argocd-app', 'rds']);
const LABEL: Record<string, string> = {
  ecs: 'ECS', ec2: 'EC2', 'argocd-app': 'ArgoCD', rds: 'RDS', dynamodb: 'DynamoDB',
  elasticache: 'ElastiCache', kafka: 'Kafka', msk: 'MSK', stepfunctions: 'StepFn',
  lambda: 'Lambda', firehose: 'Firehose',
};

function resourceId(r: ResourceRef): string {
  if (typeof r.cluster === 'string' && typeof r.service === 'string') return `${r.cluster}/${r.service}`;
  if (Array.isArray(r.instance_ids)) return (r.instance_ids as string[]).join(', ');
  if (typeof r.db_identifier === 'string') return r.db_identifier;
  if (typeof r.application === 'string') return r.application;
  if (Array.isArray(r.table_names)) return (r.table_names as string[]).join(', ');
  if (typeof r.cluster_name === 'string') return r.cluster_name;
  if (typeof r.cluster_id === 'string') return r.cluster_id;
  if (typeof r.state_machine_name === 'string') return r.state_machine_name;
  if (Array.isArray(r.function_names)) return (r.function_names as string[]).join(', ');
  if (Array.isArray(r.delivery_stream_names)) return (r.delivery_stream_names as string[]).join(', ');
  return '';
}

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function DetailDrawer({
  row,
  onClose,
  onToggle,
}: {
  row: ProjectRow;
  onClose: () => void;
  onToggle: (repo: string, op: 'turn_on' | 'turn_off') => Promise<void> | void;
}) {
  const [history, setHistory] = useState<HistoryRecord[] | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [owner, name] = row.repo.split('/');
  const pr = row.project;

  const loadHistory = useCallback(async () => {
    setHistErr(null);
    try {
      const { items } = await getHistory(owner, name);
      setHistory(items);
    } catch (e) {
      setHistErr((e as Error).message);
    }
  }, [owner, name]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { items } = await getHistory(owner, name);
        if (alive) setHistory(items);
      } catch (e) {
        if (alive) setHistErr((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [owner, name]);

  // a11y: focus the close button on open, return focus on close, Esc closes, trap Tab.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab' && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])',
        );
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  const handleToggle = async (op: 'turn_on' | 'turn_off') => {
    await onToggle(row.repo, op);
    await loadHistory(); // refresh once so the just-performed action appears
  };

  const cs = pr?.urls?.code_server;
  const demo = pr?.urls?.demo;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${pr?.name ?? row.name} detail`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div className="row">
            <h2>{pr?.name ?? row.name}</h2>
            <span className={`pill ${row.status}`}>{row.status}</span>
            <button ref={closeRef} className="drawer-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className="repo">{row.repo}</div>
          <div className="chips">
            {pr?.display?.category && <span className="chip cat">{pr.display.category}</span>}
            <span className="chip acct">{row.account}</span>
          </div>
          <footer>
            {row.status === 'on' && (
              <button className="btn on" onClick={() => void handleToggle('turn_off')}>Turn off</button>
            )}
            {(row.status === 'off' || row.status === 'error') && (
              <button className="btn off" onClick={() => void handleToggle('turn_on')}>Turn on</button>
            )}
            {row.status === 'transitioning' && (
              <button className="btn" disabled><span className="spinner" />전환 중</button>
            )}
            {row.status === 'unknown' && (
              <button className="btn" disabled>{row.status}</button>
            )}
          </footer>
        </div>

        {!pr ? (
          <div className="empty">프로젝트 상세를 불러오지 못했습니다.</div>
        ) : (
          <>
            <section className="drawer-sec">
              <h3>리소스</h3>
              <div className="reslist">
                {pr.resources.map((r, i) => {
                  const on = TOGGLEABLE.has(r.type) && !r.always_on;
                  return (
                    <div className="resrow" key={i}>
                      <span className={`chip ${on ? 'res-on' : 'res-always'}`}>{LABEL[r.type] ?? r.type}</span>
                      <span className="resid">{resourceId(r)}</span>
                    </div>
                  );
                })}
                {pr.resources.length === 0 && <div className="empty">리소스 없음</div>}
              </div>
            </section>

            <section className="drawer-sec">
              <h3>URL</h3>
              {demo ? (
                <a className="btn link" href={demo} target="_blank" rel="noopener noreferrer">데모 열기 ↗</a>
              ) : (
                <span className="btn link" aria-disabled>데모 URL 없음</span>
              )}
              {cs?.mode === 'explicit' ? (
                <a className="btn link" href={cs.url} target="_blank" rel="noopener noreferrer">code-server ↗</a>
              ) : (
                <span className="btn link" aria-disabled>
                  {cs?.mode === 'ec2-tag' ? 'code-server (ec2-tag, Stage 4)' : 'code-server 없음'}
                </span>
              )}
            </section>
          </>
        )}

        <section className="drawer-sec">
          <h3>히스토리</h3>
          {histErr && <div className="empty">히스토리 로드 실패: {histErr}</div>}
          {!histErr && history === null && <div className="empty">불러오는 중…</div>}
          {!histErr && history?.length === 0 && <div className="empty">최근 작업 없음</div>}
          <div className="timeline">
            {history?.map((h, i) => (
              <div className="tl-item" key={i}>
                <span className={`pill ${h.result === 'success' ? 'on' : h.result === 'partial' ? 'transitioning' : 'error'}`}>
                  {h.result}
                </span>
                <span className="tl-action">{h.action}</span>
                <span className="tl-meta">{h.actor} · {relTime(h.ts)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
