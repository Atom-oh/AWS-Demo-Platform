import { useEffect, useRef } from 'react';
import type { ProjectRow } from '@/lib/types';
import type { Operation } from '@/hooks/useOperations';
import { RESOURCE_LABEL, STATUS_LABEL } from '@/lib/presentation';
import { Icon } from './Icon';

export function ProjectTable({ rows, checked, active, blocked, onSelect, onSelectAll, onOpen, onToggle }: {
  rows: ProjectRow[];
  checked: Set<string>;
  active: Set<string>;
  blocked: boolean;
  onSelect: (repo: string) => void;
  onSelectAll: (select: boolean) => void;
  onOpen: (repo: string) => void;
  onToggle: (repo: string, op: Operation) => void;
}) {
  const selectAll = useRef<HTMLInputElement>(null);
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.repo));
  const someChecked = rows.some((r) => checked.has(r.repo));
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = someChecked && !allChecked;
  }, [allChecked, someChecked]);
  return (
    <div className="table-scroll" role="region" aria-label="프로젝트 운영 목록" tabIndex={0}>
      <table className="project-table">
        <thead><tr>
          <th><input ref={selectAll} type="checkbox" aria-label="표시된 프로젝트 모두 선택"
            checked={allChecked} onChange={(e) => onSelectAll(e.target.checked)} /></th>
          <th scope="col">프로젝트</th><th scope="col">계정</th><th scope="col">서비스</th>
          <th scope="col">상태</th><th scope="col">작업</th>
        </tr></thead>
        <tbody>{rows.map((row) => {
          const name = row.project?.name ?? row.name;
          const busy = active.has(row.repo);
          const canStart = row.status === 'off' || row.status === 'error';
          return (
            <tr key={row.repo} className={checked.has(row.repo) ? 'selected-row' : ''}>
              <td><input type="checkbox" aria-label={`${name} 선택`} checked={checked.has(row.repo)}
                onChange={() => onSelect(row.repo)} /></td>
              <td className="project-cell">
                <button className="table-title" aria-label={`${name} 상세 보기`} onClick={() => onOpen(row.repo)}>{name}</button>
                <span className="repo">{row.repo}</span>
              </td>
              <td>{row.account}</td>
              <td className="service-cell">{[...new Set(row.project?.resources.map((r) => r.type) ?? [])]
                .map((type) => RESOURCE_LABEL[type] ?? type).join(' · ') || '—'}</td>
              <td><span className={`pill ${busy ? 'transitioning' : row.status}`}>
                {busy ? '처리 중' : STATUS_LABEL[row.status] ?? row.status}
              </span></td>
              <td><div className="table-actions">
                <button className="btn" disabled={blocked || busy || (!canStart && row.status !== 'on')}
                  aria-label={`${name} ${canStart ? '켜기' : '끄기'}`}
                  onClick={() => onToggle(row.repo, canStart ? 'turn_on' : 'turn_off')}>
                  {busy ? <span className="spinner" /> : <Icon name="power" />}
                  {canStart ? '켜기' : '끄기'}
                </button>
                {row.project?.urls?.demo && <a className="icon-button" href={row.project.urls.demo}
                  target="_blank" rel="noopener noreferrer" aria-label={`${name} 데모 열기`}><Icon name="arrow" /></a>}
              </div></td>
            </tr>
          );
        })}</tbody>
      </table>
      <p className="table-hint">좌우로 이동해 계정과 작업을 확인하세요.</p>
    </div>
  );
}
