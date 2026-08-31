import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

    const input = screen.getByPlaceholderText(/check the ArgoCD\/ECS console/i);
    expect(input).not.toBeDisabled();
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).not.toBeDisabled();

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
    expect(screen.getByPlaceholderText(/check the ArgoCD\/ECS console/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });
});
