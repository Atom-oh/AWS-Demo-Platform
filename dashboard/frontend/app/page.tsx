'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjects } from '@/hooks/useProjects';
import { eligible, useOperations, type Operation, type OperationTarget } from '@/hooks/useOperations';
import { StatStrip } from '@/components/StatStrip';
import { FacetSidebar, type Filters } from '@/components/FacetSidebar';
import { ProjectCard } from '@/components/ProjectCard';
import { ProjectTable } from '@/components/ProjectTable';
import { OperationPanel } from '@/components/OperationPanel';
import { DetailDrawer } from '@/components/DetailDrawer';
import { Icon } from '@/components/Icon';
import { LoginGate } from '@/components/LoginGate';
import { useAuth } from '@/components/AuthProvider';
import { authEnabled } from '@/lib/auth-config';
import { RESOURCE_LABEL } from '@/lib/presentation';

const EMPTY_FILTERS: Filters = { cat: null, acct: null, status: null };
const PRIORITY = { error: 0, unknown: 1, transitioning: 2, off: 3, on: 4, external: 5 };
const compare = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
type Plan = { operation: Operation; targets: OperationTarget[]; retry?: boolean };

function DashboardInner() {
  const { username, email, logout } = useAuth();
  const { rows, loading, error, reload, toggle, scale } = useProjects();
  const ops = useOperations(rows, toggle);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [sort, setSort] = useState('attention');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const confirmation = useRef<HTMLElement>(null);
  const planTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (plan) confirmation.current?.focus();
  }, [plan]);

  useEffect(() => {
    if (!toast || toast.err) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (selected && !rows.some((r) => r.repo === selected)) setSelected(null);
    setChecked((previous) => {
      const next = new Set([...previous].filter((repo) => rows.some((r) => r.repo === repo)));
      return next.size === previous.size ? previous : next;
    });
  }, [rows, selected]);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.cat && r.project?.display?.category !== filters.cat) return false;
      if (filters.acct && r.account !== filters.acct) return false;
      if (filters.status && r.status !== filters.status) return false;
      const hay = [r.name, r.project?.name, r.repo, r.account, r.project?.description,
        ...(r.project?.resources.flatMap((x) => [x.type, RESOURCE_LABEL[x.type]]) ?? [])].join(' ').toLowerCase();
      return !query || hay.includes(query);
    }).sort((a, b) => {
      const primary = sort === 'attention' ? PRIORITY[a.status] - PRIORITY[b.status]
        : sort === 'account' ? compare.compare(a.account, b.account) : 0;
      return primary || compare.compare(a.project?.name ?? a.name, b.project?.name ?? b.name);
    });
  }, [rows, filters, q, sort]);
  const selectedRows = visible.filter((r) => checked.has(r.repo));
  const onCount = selectedRows.filter((r) => eligible(r.status, 'turn_on')).length;
  const offCount = selectedRows.filter((r) => eligible(r.status, 'turn_off')).length;
  const busy = ops.running || ops.activeRepos.size > 0;
  const mutationsBlocked = ops.running || ops.activeRepos.size >= 4;
  const hasFilters = Boolean(q.trim() || filters.cat || filters.acct || filters.status);
  const selectedRow = rows.find((r) => r.repo === selected);
  const clearSelection = () => { setChecked(new Set()); setPlan(null); };
  const resetFilters = () => { setQ(''); setFilters(EMPTY_FILTERS); clearSelection(); };
  const onRefresh = () => { setPlan(null); void reload(); };
  const openDetail = (repo: string) => {
    if (rows.some((r) => r.repo === repo)) setSelected(repo);
    else setToast({ msg: '현재 목록에 없는 프로젝트입니다. 새로고침 후 확인하세요.' });
  };
  const onToggle = async (repo: string, op: Operation) => {
    const result = await ops.runSingle(repo, op);
    setToast({ msg: result.message, err: !result.ok && !result.skipped });
    return result;
  };
  const onScale = async (repo: string, targets: Parameters<typeof scale>[1]) => {
    const result = await ops.runScale(repo, (notify) => scale(repo, targets, notify));
    setToast({ msg: result.message, err: !result.ok && !result.skipped });
    return result;
  };
  const showPlan = (operation: Operation, targets: OperationTarget[], retry = false) => {
    planTrigger.current = document.activeElement as HTMLElement | null;
    setPlan({ operation, targets, retry });
  };
  const preview = (operation: Operation) => showPlan(operation, selectedRows
    .filter((r) => eligible(r.status, operation)).map((r) => ({ repo: r.repo, name: r.project?.name ?? r.name })));
  const confirm = () => {
    if (!plan || busy) return;
    const snapshot = plan;
    setPlan(null);
    void ops.runBatch(snapshot.operation, snapshot.targets, snapshot.retry);
  };
  const notification = toast && (
    <div className={`toast${toast.err ? ' err' : ''}`} role={toast.err ? 'alert' : 'status'}>
      <span>{toast.msg}</span><button className="icon-button" aria-label="알림 닫기" onClick={() => setToast(null)}><Icon name="close" /></button>
    </div>
  );

  return (
    <>
      <a className="skip-link" href="#projects">프로젝트 목록으로 이동</a>
      <header className="topbar">
        <div className="brand-mark"><Icon name="grid" width="22" height="22" /></div>
        <div className="brand"><b>AWS Demo Platform</b><span>프로젝트 탐색 · 데모 운영</span></div>
        <span className="badge-dev">{authEnabled ? 'DEV' : 'LOCAL'}</span>
        {authEnabled && <div className="userchip"><span>{username ?? email ?? 'admin'}</span>
          <button className="btn" onClick={logout}>로그아웃</button></div>}
      </header>
      <div className="layout">
        <FacetSidebar rows={rows} filters={filters} setFilters={(f) => { setFilters(f); clearSelection(); }} />
        <main id="projects">
          <div className="page-heading">
            <div><h1>프로젝트 운영</h1><p>상태를 비교하고, 필요한 프로젝트를 선택해 한 번에 관리하세요.</p></div>
            <button className="btn" disabled={loading} onClick={onRefresh}><Icon name="refresh" />새로고침</button>
          </div>
          <StatStrip rows={rows} />
          <div className="collection-toolbar">
            <div className="search"><Icon name="search" /><input type="search" aria-label="프로젝트 검색" value={q}
              onChange={(e) => { setQ(e.target.value); clearSelection(); }} placeholder="프로젝트, 서비스, 설명 검색" /></div>
            <label className="sort-control">정렬<select aria-label="프로젝트 정렬" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="attention">확인 필요 우선</option><option value="name">이름순</option><option value="account">계정순</option>
            </select></label>
            <div className="view-switch" role="group" aria-label="보기 방식">
              <button aria-pressed={view === 'table'} onClick={() => { setView('table'); clearSelection(); }}>목록</button>
              <button aria-pressed={view === 'cards'} onClick={() => { setView('cards'); clearSelection(); }}>카드</button>
            </div>
          </div>
          <div className="results-bar"><span role="status">{loading ? '프로젝트 새로고침 중…' : `${visible.length}개 프로젝트`}</span>
            {hasFilters && <button className="text-button" onClick={resetFilters}>필터 초기화</button>}</div>
          {view === 'table' && <div className="selection-bar">
            <span><strong>{selectedRows.length}개</strong> 선택</span>
            {selectedRows.length > 0 && <button className="text-button" onClick={clearSelection}>선택 해제</button>}
            <div className="button-row">
              <button className="btn primary" disabled={busy || loading || !!error || !onCount} onClick={() => preview('turn_on')}>선택 {onCount}개 켜기</button>
              <button className="btn" disabled={busy || loading || !!error || !offCount} onClick={() => preview('turn_off')}>선택 {offCount}개 끄기</button>
            </div>
          </div>}
          {plan && <section ref={confirmation} tabIndex={-1} className="bulk-confirm" aria-label="일괄 실행 확인">
            <div><strong>{plan.targets.length}개 프로젝트를 {plan.operation === 'turn_on' ? '켤까요?' : '끌까요?'}</strong>
              <p>{plan.targets.map((r) => `${r.name} (${r.repo})`).join(', ')}</p>
              <span>확인한 대상에만 적용하며, 실행 직전에 상태를 다시 확인합니다.</span></div>
            <div className="button-row"><button className="btn" onClick={() => { setPlan(null); planTrigger.current?.focus(); }}>취소</button>
              <button className="btn primary" disabled={busy || loading || !!error || !plan.targets.length} onClick={confirm}>{plan.targets.length}개 실행</button></div>
          </section>}
          <OperationPanel results={ops.results} operation={ops.operation} running={ops.running}
            retryDisabled={busy || loading || !!error} onRetry={(targets) => showPlan(ops.operation, targets, true)}
            onClear={() => { setPlan(null); ops.clear(); }} onOpen={openDetail} />
          {error && <div className="empty" role="alert"><h2>프로젝트를 불러오지 못했습니다.</h2><p>{error}</p>
            <button className="btn" disabled={loading} onClick={onRefresh}>다시 불러오기</button></div>}
          {loading && rows.length === 0 && <div className="empty"><span className="spinner" /><p>프로젝트 상태를 확인하고 있습니다.</p></div>}
          {!loading && !error && !visible.length && <div className="empty"><h2>{rows.length ? '조건에 맞는 프로젝트가 없습니다.' : '등록된 프로젝트가 없습니다.'}</h2>
            <p>검색어와 필터를 확인하세요.</p></div>}
          {visible.length > 0 && <div aria-busy={loading}>
            {view === 'table' ? <ProjectTable rows={visible} checked={checked} active={ops.activeRepos}
              blocked={mutationsBlocked || !!error || loading} onOpen={openDetail} onToggle={onToggle}
              onSelect={(repo) => { setPlan(null); setChecked((old) => { const next = new Set(old); if (next.has(repo)) next.delete(repo); else next.add(repo); return next; }); }}
              onSelectAll={(select) => { setPlan(null); setChecked(new Set(select ? visible.map((r) => r.repo) : [])); }} />
              : <div className="grid">{visible.map((row) => <ProjectCard key={row.repo} row={row} onOpen={openDetail} onToggle={onToggle}
                disabled={mutationsBlocked || ops.activeRepos.has(row.repo) || !!error || loading} />)}</div>}
          </div>}
          {rows.length > 0 && <p className="collection-note">마지막으로 조회한 프로젝트 상태입니다. 실제 서비스 동작은 데모에 접속해 확인하세요.</p>}
        </main>
      </div>
      {selectedRow ? <DetailDrawer key={selectedRow.repo} row={selectedRow} onClose={() => setSelected(null)}
        onToggle={onToggle} onScale={onScale} notification={notification}
        actionsDisabled={mutationsBlocked || ops.activeRepos.has(selectedRow.repo) || !!error || loading} /> : notification}
    </>
  );
}

export default function Page() {
  return <LoginGate><DashboardInner /></LoginGate>;
}
