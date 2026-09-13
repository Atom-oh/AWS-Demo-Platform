import { useEffect, useRef } from 'react';
import type { Operation, OperationResult, OperationTarget } from '@/hooks/useOperations';

const LABEL = { queued: '대기', running: '처리 중', succeeded: '완료', failed: '실패', skipped: '제외' };

export function OperationPanel({ results, operation, running, retryDisabled, onRetry, onClear, onOpen }: {
  results: OperationResult[];
  operation: Operation;
  running: boolean;
  retryDisabled: boolean;
  onRetry: (targets: OperationTarget[]) => void;
  onClear: () => void;
  onOpen: (repo: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (running) heading.current?.focus();
  }, [running]);
  if (!results.length) return null;
  const failed = results.filter((r) => r.status === 'failed');
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const done = results.filter((r) => !['queued', 'running'].includes(r.status)).length;
  return (
    <section className="operation-panel" aria-label="일괄 작업 결과">
      <div className="operation-heading">
        <div><h2 ref={heading} tabIndex={-1}>일괄 {operation === 'turn_on' ? '켜기' : '끄기'} {running ? '진행 중' : '결과'}</h2>
          <p role="status">{done} / {results.length}개 처리 · 실패 {failed.length}개 · 제외 {skipped}개</p></div>
        <div className="button-row">
          {failed.length > 0 && <button className="btn" disabled={running || retryDisabled}
            onClick={() => onRetry(failed.map(({ repo, name }) => ({ repo, name })))}>
            실패 {failed.length}개 재시도
          </button>}
          <button className="btn" disabled={running} onClick={onClear}>결과 닫기</button>
        </div>
      </div>
      <progress max={results.length} value={done} aria-label="일괄 작업 진행률" />
      <div className="operation-results">
        {results.map((result) => (
          <div className={`operation-result ${result.status}`} key={result.repo}>
            <button className="text-button" onClick={() => onOpen(result.repo)}>{result.name}</button>
            <span className="operation-state">{LABEL[result.status]}</span>
            {result.message && <p>{result.message}</p>}
            {result.retryNote && <p>재시도 요청 안 함: {result.retryNote}</p>}
          </div>
        ))}
      </div>
      {running && <p className="muted">최대 4개씩 처리합니다. 이 화면을 유지해야 대기 항목이 계속 실행됩니다.</p>}
    </section>
  );
}
