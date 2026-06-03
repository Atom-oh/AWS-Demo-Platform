import type { ProjectRow } from '@/lib/types';

export function StatStrip({ rows }: { rows: ProjectRow[] }) {
  const on = rows.filter((r) => r.status === 'on').length;
  const off = rows.filter((r) => r.status === 'off').length;
  const accounts = new Set(rows.map((r) => r.account)).size;
  return (
    <div className="stats">
      <div className="stat">
        <div className="n">{rows.length}</div>
        <div className="l">프로젝트</div>
      </div>
      <div className="stat">
        <div className="n">{accounts}</div>
        <div className="l">계정</div>
      </div>
      <div className="stat on">
        <div className="n">{on}</div>
        <div className="l">ON</div>
      </div>
      <div className="stat off">
        <div className="n">{off}</div>
        <div className="l">OFF</div>
      </div>
    </div>
  );
}
