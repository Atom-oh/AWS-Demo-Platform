import type { ProjectRow } from '@/lib/types';

const TOGGLEABLE = new Set(['ecs', 'ec2', 'argocd-app', 'rds']);
const LABEL: Record<string, string> = {
  ecs: 'ECS',
  ec2: 'EC2',
  'argocd-app': 'ArgoCD',
  rds: 'RDS',
  dynamodb: 'DynamoDB',
  elasticache: 'ElastiCache',
  kafka: 'Kafka',
  msk: 'MSK',
  stepfunctions: 'StepFn',
  lambda: 'Lambda',
  firehose: 'Firehose',
};

export function ProjectCard({
  row,
  onToggle,
  onOpen,
}: {
  row: ProjectRow;
  onToggle: (repo: string, op: 'turn_on' | 'turn_off') => void;
  onOpen: (repo: string) => void;
}) {
  const pr = row.project;
  const cat = pr?.display?.category;
  const demo = pr?.urls?.demo;
  const st = row.status;
  return (
    <div
      className="card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row.repo)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(row.repo);
        }
      }}
    >
      <div className="row">
        <h2>{pr?.name ?? row.name}</h2>
        <span className={`pill ${st}`}>{st}</span>
      </div>
      <div className="repo">{row.repo}</div>
      <div className="chips">
        {cat && <span className="chip cat">{cat}</span>}
        <span className="chip acct">{row.account}</span>
      </div>
      {pr?.description && <div className="desc">{pr.description}</div>}
      <div className="chips">
        {(pr?.resources ?? []).map((r, i) => {
          const toggleable = TOGGLEABLE.has(r.type) && !r.always_on;
          return (
            <span key={i} className={`chip ${toggleable ? 'res-on' : 'res-always'}`}>
              {LABEL[r.type] ?? r.type}
            </span>
          );
        })}
        {!pr?.resources?.length && <span className="chip">리소스 정보 없음</span>}
      </div>
      <footer>
        {st === 'on' && (
          <button className="btn on" onClick={(e) => { e.stopPropagation(); onToggle(row.repo, 'turn_off'); }}>
            Turn off
          </button>
        )}
        {st === 'off' && (
          <button className="btn off" onClick={(e) => { e.stopPropagation(); onToggle(row.repo, 'turn_on'); }}>
            Turn on
          </button>
        )}
        {st === 'transitioning' && (
          <button className="btn" disabled>
            <span className="spinner" />
            전환 중
          </button>
        )}
        {(st === 'unknown' || st === 'error') && (
          <button className="btn" disabled>
            {st}
          </button>
        )}
        {demo ? (
          <a className="btn link" href={demo} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            데모 열기 ↗
          </a>
        ) : (
          <span className="btn link" aria-disabled>
            데모 URL 없음
          </span>
        )}
      </footer>
    </div>
  );
}
