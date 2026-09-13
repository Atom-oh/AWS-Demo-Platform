import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectTable } from '@/components/ProjectTable';
import { ProjectCard } from '@/components/ProjectCard';
import { DetailDrawer } from '@/components/DetailDrawer';
import { eligible } from '@/hooks/useOperations';
import type { ProjectRow } from '@/lib/types';

vi.mock('@/lib/api', () => ({ getHistory: vi.fn(async () => ({ items: [] })) }));
const row: ProjectRow = {
  repo: 'org/external', name: 'External', account: 'main', status: 'external',
  project: {
    name: 'External', github: { repo: 'org/external', branch: 'main' }, account: 'main',
    management: 'external', resources: [{ type: 'ecs', stepKey: 'ecs:c/s', cluster: 'c', service: 's' }],
    urls: { demo: 'https://example.com' },
  },
};

describe('external ownership UI', () => {
  it('keeps discovery links but excludes external projects from lifecycle controls', async () => {
    const toggle = vi.fn();
    render(<ProjectTable rows={[row]} checked={new Set()} active={new Set()} blocked={false}
      onSelect={vi.fn()} onSelectAll={vi.fn()} onOpen={vi.fn()} onToggle={toggle} />);
    expect(screen.getByText('외부 관리')).toBeInTheDocument();
    expect(screen.getByText('조회 전용')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'External 끄기' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'External 데모 열기' })).toHaveAttribute('href', 'https://example.com');
    await userEvent.click(screen.getByRole('checkbox', { name: 'External 선택' }));
    expect(eligible(row.status, 'turn_on')).toBe(false);
    expect(eligible(row.status, 'turn_off')).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
  });

  it('does not offer toggle or scale in the card and drawer', () => {
    render(<><ProjectCard row={row} onOpen={vi.fn()} onToggle={vi.fn()} />
      <DetailDrawer row={row} onClose={vi.fn()} onToggle={vi.fn()} onScale={vi.fn()} /></>);
    expect(within(screen.getByRole('article')).queryByRole('button', { name: /켜기|끄기/ })).not.toBeInTheDocument();
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.queryByRole('button', { name: /켜기|끄기|적용/ })).not.toBeInTheDocument();
    expect(drawer.queryByRole('spinbutton')).not.toBeInTheDocument();
  });
});
