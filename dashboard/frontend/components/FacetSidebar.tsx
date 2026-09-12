import { useState } from 'react';
import type { ProjectRow } from '@/lib/types';
import { STATUS_LABEL } from '@/lib/presentation';

export interface Filters {
  cat: string | null;
  acct: string | null;
  status: string | null;
}

function tally(rows: ProjectRow[], key: (r: ProjectRow) => string | undefined | null) {
  const m: Record<string, number> = {};
  rows.forEach((r) => {
    const v = key(r);
    if (v) m[v] = (m[v] ?? 0) + 1;
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function Group({
  title,
  items,
  active,
  onPick,
  labels,
}: {
  title: string;
  items: [string, number][];
  active: string | null;
  onPick: (v: string) => void;
  labels?: Record<string, string>;
}) {
  return (
    <div className="facet-group">
      <h3>{title}</h3>
      {items.length ? (
        items.map(([k, n]) => (
          <button key={k} aria-pressed={active === k} className={`facet${active === k ? ' active' : ''}`} onClick={() => onPick(k)}>
            <span>{labels?.[k] ?? k}</span>
            <span className="cnt">{n}</span>
          </button>
        ))
      ) : (
        <div className="facet-empty">—</div>
      )}
    </div>
  );
}

export function FacetSidebar({
  rows,
  filters,
  setFilters,
}: {
  rows: ProjectRow[];
  filters: Filters;
  setFilters: (f: Filters) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pick = (key: keyof Filters) => (v: string) =>
    setFilters({ ...filters, [key]: filters[key] === v ? null : v });
  return (
    <aside className={`sidebar${expanded ? ' expanded' : ''}`} aria-label="프로젝트 필터">
      <button className="btn mobile-filters" aria-expanded={expanded} aria-controls="project-facets"
        onClick={() => setExpanded((v) => !v)}>
        필터 {Object.values(filters).filter(Boolean).length > 0 && `(${Object.values(filters).filter(Boolean).length})`}
      </button>
      <div className="sidebar-title">둘러보기</div>
      <div id="project-facets">
      <Group
        title="카테고리"
        items={tally(rows, (r) => r.project?.display?.category)}
        active={filters.cat}
        onPick={pick('cat')}
      />
      <Group title="계정" items={tally(rows, (r) => r.account)} active={filters.acct} onPick={pick('acct')} />
      <Group title="상태" items={tally(rows, (r) => r.status)} active={filters.status} onPick={pick('status')} labels={STATUS_LABEL} />
      </div>
    </aside>
  );
}
