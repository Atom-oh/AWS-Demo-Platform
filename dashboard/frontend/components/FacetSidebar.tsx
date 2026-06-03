import type { ProjectRow } from '@/lib/types';

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
}: {
  title: string;
  items: [string, number][];
  active: string | null;
  onPick: (v: string) => void;
}) {
  return (
    <>
      <h3>{title}</h3>
      {items.length ? (
        items.map(([k, n]) => (
          <button key={k} className={`facet${active === k ? ' active' : ''}`} onClick={() => onPick(k)}>
            <span>{k}</span>
            <span className="cnt">{n}</span>
          </button>
        ))
      ) : (
        <div className="facet-empty">—</div>
      )}
    </>
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
  const pick = (key: keyof Filters) => (v: string) =>
    setFilters({ ...filters, [key]: filters[key] === v ? null : v });
  return (
    <aside>
      <Group
        title="카테고리"
        items={tally(rows, (r) => r.project?.display?.category)}
        active={filters.cat}
        onPick={pick('cat')}
      />
      <Group title="계정" items={tally(rows, (r) => r.account)} active={filters.acct} onPick={pick('acct')} />
      <Group title="상태" items={tally(rows, (r) => r.status)} active={filters.status} onPick={pick('status')} />
    </aside>
  );
}
