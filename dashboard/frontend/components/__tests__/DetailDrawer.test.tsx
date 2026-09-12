import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetailDrawer } from '@/components/DetailDrawer';
import type { ProjectRow } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  getHistory: vi.fn(async () => ({ items: [] })),
}));

const row: ProjectRow = {
  repo: 'org/multi-region-mall',
  name: 'multi-region-mall',
  account: 'atomoh-main',
  status: 'on',
  project: {
    name: 'multi-region-mall',
    github: { repo: 'org/multi-region-mall', branch: 'main' },
    account: 'atomoh-main',
    resources: [
      {
        type: 'argocd-app',
        stepKey: 'argocd-app:workloads-apne2-az-a',
        application: 'workloads-apne2-az-a',
      },
    ],
  },
};

describe('DetailDrawer argocd-app scale control', () => {
  it('is enabled (not the old permanently-disabled placeholder) and calls onScale with replicas', async () => {
    const onScale = vi.fn();
    render(
      <DetailDrawer row={row} onClose={() => {}} onToggle={() => {}} onScale={onScale} />,
    );

    const input = screen.getByRole('spinbutton', { name: /목표 수/ });
    expect(input).not.toBeDisabled();
    const apply = screen.getByRole('button', { name: '적용' });
    expect(apply).toBeDisabled();

    await userEvent.type(input, '3');
    await userEvent.click(apply);

    expect(onScale).toHaveBeenCalledWith('org/multi-region-mall', [
      { stepKey: 'argocd-app:workloads-apne2-az-a', replicas: 3 },
    ]);
  });

  it('disables the control when the project is not on', () => {
    const offRow: ProjectRow = { ...row, status: 'off' };
    render(
      <DetailDrawer row={offRow} onClose={() => {}} onToggle={() => {}} onScale={vi.fn()} />,
    );
    expect(screen.getByRole('spinbutton', { name: /목표 수/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '적용' })).toBeDisabled();
  });

  it('rejects out-of-range counts and prevents a duplicate request while the job is pending', async () => {
    let finish!: (value: { ok: boolean }) => void;
    const onScale = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => { finish = resolve; }));
    render(<DetailDrawer row={row} onClose={() => {}} onToggle={() => {}} onScale={onScale} />);
    const input = screen.getByRole('spinbutton', { name: /목표 수/ });
    const apply = screen.getByRole('button', { name: '적용' });
    await userEvent.type(input, '21');
    expect(apply).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, '3');
    await userEvent.dblClick(apply);
    expect(onScale).toHaveBeenCalledTimes(1);
    expect(input).toBeDisabled();
    expect(screen.getByRole('form', { name: /수량 변경/ })).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus();
    await act(async () => finish({ ok: true }));
    expect(screen.getByText('목표 수를 적용했습니다.')).toBeInTheDocument();
    expect(screen.getByText(/저장된 기준이 있는 경우에만/)).toBeInTheDocument();
  });

  it('keeps notification dismissal inside the modal focus scope', async () => {
    render(<DetailDrawer row={row} onClose={() => {}} onToggle={() => {}}
      notification={<button>알림 닫기</button>} />);
    expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('button', { name: '알림 닫기' }));
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: '알림 닫기' })).toHaveFocus();
  });
});
