'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectRow, HistoryRecord, ResourceRef, ScaleTarget } from '@/lib/types';
import { getHistory } from '@/lib/api';
import { RESOURCE_LABEL as LABEL, STATUS_LABEL } from '@/lib/presentation';
import { Icon } from './Icon';
import { ScaleControl } from './ScaleControl';

const TOGGLEABLE = new Set(['ecs', 'ec2', 'argocd-app', 'rds']);
const BRIEFING_PREVIEW_LIMIT = 2000;

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
  onScale,
  notification,
}: {
  row: ProjectRow;
  onClose: () => void;
  onToggle: (repo: string, op: 'turn_on' | 'turn_off') => Promise<{ ok: boolean }> | void;
  onScale?: (repo: string, targets: ScaleTarget[]) => Promise<{ ok: boolean }> | void;
  notification?: ReactNode;
}) {
  const [history, setHistory] = useState<HistoryRecord[] | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const mountedRef = useRef(true);
  const [owner, name] = row.repo.split('/');
  const pr = row.project;

  const loadHistory = useCallback(async () => {
    setHistErr(null);
    try {
      const { items } = await getHistory(owner, name);
      if (mountedRef.current) setHistory(items);
    } catch (e) {
      if (mountedRef.current) setHistErr((e as Error).message);
    }
  }, [owner, name]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ));
        if (focusable.length === 0) return;
        const active = document.activeElement;
        const index = focusable.indexOf(active as HTMLElement);
        // A pending scale form is programmatically focused but not in the Tab order.
        // Resolve its next control in DOM order, wrapping before focus can leave.
        const next = index >= 0
          ? focusable[(index + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length]
          : e.shiftKey
            ? focusable.filter((el) => active && (active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)).pop() ?? focusable[focusable.length - 1]
            : focusable.find((el) => active && (active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? focusable[0];
        e.preventDefault();
        next.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
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
        aria-label={`${pr?.name ?? row.name} 상세`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div className="row">
            <h2>{pr?.name ?? row.name}</h2>
            <span className={`pill ${row.status}`}>{STATUS_LABEL[row.status]}</span>
            <button ref={closeRef} className="drawer-close" onClick={onClose} aria-label="닫기">
              <Icon name="close" />
            </button>
          </div>
          <a className="repo" href={`https://github.com/${row.repo}`} target="_blank" rel="noreferrer">
            {row.repo}
          </a>
          <div className="chips">
            {pr?.display?.category && <span className="chip cat">{pr.display.category}</span>}
            <span className="chip acct">{row.account}</span>
          </div>
          {pr?.description && <p className="desc">{pr.description}</p>}
          <footer>
            {row.status === 'on' && (
              <button className="btn" onClick={() => void handleToggle('turn_off')}>끄기</button>
            )}
            {(row.status === 'off' || row.status === 'error') && (
              <button className="btn primary" onClick={() => void handleToggle('turn_on')}>{row.status === 'error' ? '다시 켜기' : '켜기'}</button>
            )}
            {row.status === 'transitioning' && (
              <button className="btn" disabled><span className="spinner" />전환 중</button>
            )}
            {row.status === 'unknown' && (
              <button className="btn" disabled>상태 미확인</button>
            )}
            {demo && <a className="btn primary" href={demo} target="_blank" rel="noopener noreferrer">데모 열기<Icon name="arrow" /></a>}
          </footer>
        </div>

        {!pr ? (
          <div className="empty">프로젝트 상세를 불러오지 못했습니다.</div>
        ) : (
          <>
            {pr.briefing && (
              <section className="drawer-sec">
                <h3>데모 브리핑</h3>
                <div className="briefing">
                  {briefingExpanded || pr.briefing.length <= BRIEFING_PREVIEW_LIMIT
                    ? pr.briefing
                    : `${pr.briefing.slice(0, BRIEFING_PREVIEW_LIMIT)}…`}
                </div>
                {pr.briefing.length > BRIEFING_PREVIEW_LIMIT && (
                  <button
                    className="btn link"
                    onClick={() => setBriefingExpanded((v) => !v)}
                  >
                    {briefingExpanded ? '접기' : '더 보기'}
                  </button>
                )}
              </section>
            )}
            <section className="drawer-sec">
              <h3>리소스</h3>
              <div className="reslist">
                {pr.resources.map((r) => {
                  const on = TOGGLEABLE.has(r.type) && !r.always_on;
                  const isEcs = r.type === 'ecs';
                  const isArgocdApp = r.type === 'argocd-app';
                  return (
                    <div className="resrow" key={r.stepKey}>
                      <span className={`chip ${on ? 'res-on' : 'res-always'}`}>{LABEL[r.type] ?? r.type}</span>
                      <span className="resid">{resourceId(r)}</span>
                      {!on && <span className="muted">일괄 끄기 제외</span>}
                      {(isEcs || isArgocdApp) && (
                        <ScaleControl resource={r} status={row.status}
                          onScale={onScale ? (targets) => onScale(row.repo, targets) : undefined} />
                      )}
                    </div>
                  );
                })}
                {pr.resources.length === 0 && <div className="empty">리소스 없음</div>}
              </div>
            </section>

            <section className="drawer-sec">
              <h3>바로가기</h3>
              {demo ? (
                <a className="btn link" href={demo} target="_blank" rel="noopener noreferrer">데모 열기<Icon name="arrow" /></a>
              ) : (
                <span className="btn link" aria-disabled>데모 URL 없음</span>
              )}
              {cs?.mode === 'explicit' ? (
                <a className="btn link" href={cs.url} target="_blank" rel="noopener noreferrer">개발 환경<Icon name="arrow" /></a>
              ) : (
                <span className="btn link" aria-disabled>
                  {cs?.mode === 'ec2-tag' ? '개발 환경 주소 확인이 필요합니다.' : '개발 환경 미등록'}
                </span>
              )}
            </section>
          </>
        )}

        <section className="drawer-sec">
          <h3>최근 작업</h3>
          {histErr && <div className="empty">히스토리 로드 실패: {histErr}</div>}
          {!histErr && history === null && <div className="empty">불러오는 중…</div>}
          {!histErr && history?.length === 0 && <div className="empty">최근 작업 없음</div>}
          <div className="timeline">
            {history?.map((h, i) => (
              <div className="tl-item" key={i}>
                <span className={`pill ${h.result === 'success' ? 'on' : h.result === 'partial' ? 'transitioning' : 'error'}`}>
                  {h.result === 'success' ? '완료' : h.result === 'partial' ? '일부 완료' : '실패'}
                </span>
                <span className="tl-action">{h.action === 'turn_on' ? '켜기' : h.action === 'turn_off' ? '끄기' : h.action === 'scale' ? '수량 변경' : h.action}</span>
                <span className="tl-meta">{h.actor} · {relTime(h.ts)}</span>
              </div>
            ))}
          </div>
        </section>
        {notification}
      </div>
    </div>
  );
}
