'use client';
import { useEffect, useMemo, useState } from 'react';
import { useProjects } from '@/hooks/useProjects';
import { StatStrip } from '@/components/StatStrip';
import { FacetSidebar, type Filters } from '@/components/FacetSidebar';
import { ProjectCard } from '@/components/ProjectCard';

export default function Dashboard() {
  const { rows, loading, error, toggle } = useProjects();
  const [filters, setFilters] = useState<Filters>({ cat: null, acct: null, status: null });
  const [q, setQ] = useState('');
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (filters.cat && r.project?.display?.category !== filters.cat) return false;
        if (filters.acct && r.account !== filters.acct) return false;
        if (filters.status && r.status !== filters.status) return false;
        if (q) {
          const hay = [
            r.name,
            r.repo,
            r.account,
            r.project?.description,
            ...(r.project?.resources.map((x) => x.type) ?? []),
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q.toLowerCase())) return false;
        }
        return true;
      }),
    [rows, filters, q],
  );

  const onToggle = (repo: string, op: 'turn_on' | 'turn_off') =>
    toggle(repo, op, (msg, err) => setToast({ msg, err }));

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <b>AWS Demo Platform</b>
          <span>Demo lifecycle &amp; discovery</span>
        </div>
        <span className="badge-dev">DEV</span>
        <div className="search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색: 프로젝트, repo, 태그, 설명…"
          />
        </div>
      </header>
      <div className="layout">
        <FacetSidebar rows={rows} filters={filters} setFilters={setFilters} />
        <main>
          <StatStrip rows={rows} />
          <div className="grid">
            {loading && <div className="empty">불러오는 중…</div>}
            {error && <div className="empty">API 로드 실패: {error}</div>}
            {!loading && !error && visible.length === 0 && (
              <div className="empty">조건에 맞는 프로젝트가 없습니다.</div>
            )}
            {visible.map((r) => (
              <ProjectCard key={r.repo} row={r} onToggle={onToggle} />
            ))}
          </div>
        </main>
      </div>
      {toast && <div className={`toast show${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
    </>
  );
}
