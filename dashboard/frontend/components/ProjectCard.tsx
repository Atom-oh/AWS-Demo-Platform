import type { ProjectRow } from '@/lib/types';
import { RESOURCE_LABEL, STATUS_LABEL } from '@/lib/presentation';
import { Icon } from './Icon';

export function ProjectCard({ row, onToggle, onOpen }: {
  row: ProjectRow;
  onToggle: (repo: string, op: 'turn_on' | 'turn_off') => void;
  onOpen: (repo: string) => void;
}) {
  const pr = row.project;
  const name = pr?.name ?? row.name;
  const demo = pr?.urls?.demo;
  const resources = [...new Set(pr?.resources.map((r) => r.type) ?? [])];
  return (
    <article className={`card status-${row.status}`} aria-label={name}>
      <div className="card-meta">
        <span>{pr?.display?.category ?? '프로젝트'}</span>
        <span className={`pill ${row.status}`}>{STATUS_LABEL[row.status]}</span>
      </div>
      <h2>
        <button className="card-title" aria-label={`${name} 상세 보기`} onClick={() => onOpen(row.repo)}>
          {name}<Icon name="chevron" />
        </button>
      </h2>
      <p className="desc">{pr?.description ?? '상세 화면에서 프로젝트 정보를 확인하세요.'}</p>
      <div className="chips" aria-label="사용 서비스">
        {resources.map((type) => <span key={type} className="chip">{RESOURCE_LABEL[type] ?? type}</span>)}
        {!resources.length && <span className="chip">리소스 정보 없음</span>}
      </div>
      <div className="card-context">
        <span>{row.account}</span>
        <a className="repo" href={`https://github.com/${row.repo}`} target="_blank" rel="noreferrer">
          {row.repo}<Icon name="arrow" width="14" height="14" />
        </a>
      </div>
      <footer>
        {row.status === 'on' && (
          <button className="btn" onClick={() => onToggle(row.repo, 'turn_off')}>
            <Icon name="power" />끄기
          </button>
        )}
        {(row.status === 'off' || row.status === 'error') && (
          <button className="btn primary" onClick={() => onToggle(row.repo, 'turn_on')}>
            <Icon name="power" />{row.status === 'error' ? '다시 켜기' : '켜기'}
          </button>
        )}
        {row.status === 'transitioning' && (
          <button className="btn" disabled><span className="spinner" />전환 중</button>
        )}
        {row.status === 'unknown' && <span className="muted">새로고침으로 상태 확인</span>}
        {demo ? (
          <a className={`btn demo-link${row.status === 'on' ? ' primary' : ''}`}
            href={demo} target="_blank" rel="noopener noreferrer">
            데모 열기<Icon name="arrow" />
          </a>
        ) : <span className="demo-link muted">데모 URL 미등록</span>}
      </footer>
    </article>
  );
}
