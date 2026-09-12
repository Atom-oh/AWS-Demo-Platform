import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectCard } from '@/components/ProjectCard';
import type { ProjectRow } from '@/lib/types';

const row: ProjectRow = {
  repo: 'org/demo-repo',
  name: 'demo-repo',
  account: 'acc-1',
  project: null,
  status: 'off',
};

describe('ProjectCard repo link', () => {
  it('links to the GitHub repo', () => {
    render(<ProjectCard row={row} onToggle={() => {}} onOpen={() => {}} />);
    const link = screen.getByRole('link', { name: 'org/demo-repo' });
    expect(link).toHaveAttribute('href', 'https://github.com/org/demo-repo');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('clicking the repo link does not open the detail drawer', async () => {
    const onOpen = vi.fn();
    render(<ProjectCard row={row} onToggle={() => {}} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('link', { name: 'org/demo-repo' }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens details with a native keyboard button without triggering a lifecycle action', async () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(<ProjectCard row={row} onToggle={onToggle} onOpen={onOpen} />);
    screen.getByRole('button', { name: 'demo-repo 상세 보기' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(row.repo);
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByRole('article')).not.toHaveAttribute('role', 'button');
  });
});
