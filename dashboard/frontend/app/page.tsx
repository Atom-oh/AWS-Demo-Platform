'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjects } from '@/hooks/useProjects';
import { StatStrip } from '@/components/StatStrip';
import { FacetSidebar, type Filters } from '@/components/FacetSidebar';
import { ProjectCard } from '@/components/ProjectCard';
import { DetailDrawer } from '@/components/DetailDrawer';
import { Icon } from '@/components/Icon';
import { LoginGate } from '@/components/LoginGate';
import { useAuth } from '@/components/AuthProvider';
import { authEnabled } from '@/lib/auth-config';

const EMPTY_FILTERS: Filters = { cat: null, acct: null, status: null };

function DashboardInner() {
  const { username, email, logout } = useAuth();
  const { rows, loading, error, reload, toggle, turnOnAll, scale } = useProjects();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [turningOnAll, setTurningOnAll] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const bulkLock = useRef(false);

  useEffect(() => {
    if (!toast || toast.err) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (selected && !rows.some((r) => r.repo === selected)) setSelected(null);
  }, [rows, selected]);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.cat && r.project?.display?.category !== filters.cat) return false;
      if (filters.acct && r.account !== filters.acct) return false;
      if (filters.status && r.status !== filters.status) return false;
      const hay = [r.name, r.repo, r.account, r.project?.description,
        ...(r.project?.resources.map((x) => x.type) ?? [])].join(' ').toLowerCase();
      return !query || hay.includes(query);
    });
  }, [rows, filters, q]);
  const candidates = visible.filter((r) => r.status === 'off' || r.status === 'error');
  const hasFilters = Boolean(q || filters.cat || filters.acct || filters.status);
  const selectedRow = rows.find((r) => r.repo === selected);
  const resetFilters = () => { setQ(''); setFilters(EMPTY_FILTERS); setConfirmBulk(false); };
  const onToggle = (repo: string, op: 'turn_on' | 'turn_off') =>
    toggle(repo, op, (msg, err) => setToast({ msg, err }));
  const onScale = (repo: string, targets: Parameters<typeof scale>[1]) =>
    scale(repo, targets, (msg, err) => setToast({ msg, err }));
  const notification = toast && (
    <div className={`toast${toast.err ? ' err' : ''}`} role={toast.err ? 'alert' : 'status'}>
      <span>{toast.msg}</span><button className="icon-button" aria-label="알림 닫기" onClick={() => setToast(null)}><Icon name="close" /></button>
    </div>
  );

  const onTurnOnAll = async () => {
    if (bulkLock.current || candidates.length === 0) return;
    bulkLock.current = true;
    setTurningOnAll(true);
    setConfirmBulk(false);
    try {
      const results = await turnOnAll(candidates.map((r) => ({ repo: r.repo, status: r.status })));
      const failed = results.filter((r) => !r.ok);
      setToast(failed.length
        ? { msg: `${failed.length}개 실행 실패: ${failed.map((r) => r.repo).join(', ')}`, err: true }
        : { msg: `${results.length}개 프로젝트 실행이 완료되었습니다.` });
    } finally {
      bulkLock.current = false;
      setTurningOnAll(false);
    }
  };

  return (
    <>
      <a className="skip-link" href="#projects">프로젝트 목록으로 이동</a>
      <header className="topbar">
        <div className="brand-mark"><Icon name="grid" width="22" height="22" /></div>
        <div className="brand"><b>AWS Demo Platform</b><span>프로젝트 탐색 · 데모 운영</span></div>
        <span className="badge-dev">{authEnabled ? 'DEV' : 'LOCAL'}</span>
        {authEnabled && (
          <div className="userchip"><span>{username ?? email ?? 'admin'}</span>
            <button className="btn" onClick={logout}>로그아웃</button>
          </div>
        )}
      </header>
      <div className="layout">
        <FacetSidebar rows={rows} filters={filters} setFilters={(f) => { setFilters(f); setConfirmBulk(false); }} />
        <main id="projects">
          <div className="page-heading">
            <div><h1>데모 프로젝트</h1><p>프로젝트를 찾고, 리소스를 준비하고, 데모를 시작하세요.</p></div>
            <button className="btn" disabled={loading || turningOnAll} onClick={() => void reload()}>
              <Icon name="refresh" />새로고침
            </button>
          </div>
          <StatStrip rows={rows} />
          <div className="collection-toolbar">
            <div className="search"><Icon name="search" />
              <input type="search" aria-label="프로젝트 검색" value={q}
                onChange={(e) => { setQ(e.target.value); setConfirmBulk(false); }}
                placeholder="프로젝트, 서비스, 설명 검색" />
            </div>
            <button className="btn primary" disabled={loading || !!error || turningOnAll || !candidates.length}
              onClick={() => setConfirmBulk((v) => !v)} aria-expanded={confirmBulk}>
              {turningOnAll ? <><span className="spinner" />프로젝트 켜는 중</> : <><Icon name="power" />표시된 {candidates.length}개 켜기</>}
            </button>
          </div>
          {confirmBulk && !error && !loading && (
            <section className="bulk-confirm" aria-label="일괄 실행 확인">
              <div><strong>{candidates.length}개 프로젝트를 켤까요?</strong>
                <p>{candidates.map((r) => r.name).join(', ') || '실행할 프로젝트가 없습니다.'}</p>
                <span>현재 필터에 표시된 중지·오류 상태의 프로젝트에만 적용됩니다.</span></div>
              <div className="button-row"><button className="btn" onClick={() => setConfirmBulk(false)}>취소</button>
                <button className="btn primary" disabled={!candidates.length} onClick={() => void onTurnOnAll()}>{candidates.length}개 실행</button></div>
            </section>
          )}
          <div className="results-bar">
            <span role="status">{loading ? '프로젝트 불러오는 중…' : `${visible.length}개 프로젝트`}</span>
            {hasFilters && <button className="text-button" onClick={resetFilters}>필터 초기화</button>}
          </div>
          <div className="grid" aria-busy={loading}>
            {loading && <div className="empty"><span className="spinner" /><p>프로젝트 상태를 확인하고 있습니다.</p></div>}
            {error && <div className="empty" role="alert"><h2>프로젝트를 불러오지 못했습니다.</h2><p>{error}</p>
              <button className="btn" onClick={() => void reload()}>다시 불러오기</button></div>}
            {!loading && !error && visible.length === 0 && <div className="empty"><Icon name="search" width="32" height="32" />
              <h2>{rows.length ? '조건에 맞는 프로젝트가 없습니다.' : '등록된 프로젝트가 없습니다.'}</h2>
              <p>{rows.length ? '다른 검색어를 사용하거나 필터를 초기화해 보세요.' : '프로젝트를 등록하면 이곳에서 상태와 리소스를 확인할 수 있습니다.'}</p></div>}
            {!loading && !error && visible.map((r) => <ProjectCard key={r.repo} row={r} onToggle={onToggle} onOpen={setSelected} />)}
          </div>
          {!loading && !error && rows.length > 0 && <p className="collection-note">실행 상태는 마지막으로 조회한 리소스 상태입니다. 데모 접속 후 서비스 동작을 확인하세요.</p>}
        </main>
      </div>
      {selectedRow
        ? <DetailDrawer key={selectedRow.repo} row={selectedRow} onClose={() => setSelected(null)}
            onToggle={onToggle} onScale={onScale} notification={notification} />
        : notification}
    </>
  );
}

export default function Page() {
  return <LoginGate><DashboardInner /></LoginGate>;
}
