'use client';
import { useId, useRef, useState } from 'react';
import type { ResourceRef, ScaleTarget, Status } from '@/lib/types';
import { ECS_SCALE_NOTE, HPA_SCALE_NOTE, MAX_SCALE_COUNT } from '@/lib/presentation';

export function ScaleControl({ resource, status, onScale }: {
  resource: ResourceRef;
  status: Status;
  onScale?: (targets: ScaleTarget[]) => Promise<{ ok: boolean }> | void;
}) {
  const id = useId();
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const lock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const count = Number(value);
  const valid = value !== '' && Number.isInteger(count) && count >= 1 && count <= MAX_SCALE_COUNT;
  const disabled = status !== 'on' || pending || !onScale;
  const apply = async () => {
    if (disabled || !valid || lock.current) return;
    lock.current = true;
    setPending(true);
    setFeedback('');
    formRef.current?.focus();
    try {
      const result = await onScale?.([resource.type === 'ecs'
        ? { stepKey: resource.stepKey, desiredCount: count }
        : { stepKey: resource.stepKey, replicas: count }]);
      setFeedback(result?.ok
        ? '목표 수를 적용했습니다.'
        : '적용 결과를 확인하지 못했습니다. 알림과 리소스 상태를 확인하세요.');
    } catch {
      setFeedback('적용하지 못했습니다. 리소스 상태를 확인하고 다시 시도하세요.');
    } finally {
      lock.current = false;
      setPending(false);
    }
  };

  return (
    <form ref={formRef} tabIndex={-1} className="scale-ctl" aria-label={`${resource.stepKey} 수량 변경`}
      onSubmit={(e) => { e.preventDefault(); void apply(); }}>
      <label htmlFor={id}>목표 수</label>
      <input id={id} type="number" min={1} max={MAX_SCALE_COUNT} step={1}
        aria-label={`${resource.stepKey} 목표 수`} aria-describedby={`${id}-help`}
        placeholder="1–20" value={value} disabled={disabled}
        onChange={(e) => { setValue(e.target.value); setFeedback(''); }} />
      <button type="submit" className="btn" disabled={disabled || !valid}>
        {pending ? <><span className="spinner" />적용 중</> : '적용'}
      </button>
      <span id={`${id}-help`} className="scale-note">
        {status !== 'on' ? '프로젝트를 켜면 수량을 변경할 수 있습니다.' : '현재 수량은 ArgoCD / ECS 콘솔에서 확인하세요. 입력 범위: 1–20.'}
      </span>
      <span className="scale-note">{resource.type === 'argocd-app'
        ? HPA_SCALE_NOTE
        : ECS_SCALE_NOTE}</span>
      {feedback && <span className="scale-feedback" role="status">{feedback}</span>}
    </form>
  );
}
