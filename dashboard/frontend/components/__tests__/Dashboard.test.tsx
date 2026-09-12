import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Page from '@/app/page';
import type { ProjectRow } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  turnOnAll: vi.fn(async () => []),
  reload: vi.fn(),
  error: null as string | null,
  transitioning: false,
}));
const rows: ProjectRow[] = [
  { repo: 'org/mall', name: 'Mall', account: 'one', project: null, status: 'off' },
  { repo: 'org/voice', name: 'Voice', account: 'two', status: 'off', project: {
    name: 'Voice analytics', account: 'two', github: { repo: 'org/voice', branch: 'main' },
    resources: [{ type: 'stepfunctions', stepKey: 'stepfunctions:voice' }],
  } },
  { repo: 'org/live', name: 'Live', account: 'one', project: null, status: 'on' },
];
vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({
    rows: mocks.transitioning ? rows.map((r) => ({ ...r, status: 'transitioning' })) : rows,
    loading: false, error: mocks.error, reload: mocks.reload,
    turnOnAll: mocks.turnOnAll, toggle: vi.fn(), scale: vi.fn(),
  }),
}));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock('@/components/LoginGate', () => ({
  LoginGate: ({ children }: { children: React.ReactNode }) => children,
}));

describe('Dashboard discovery and bulk scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.error = null;
    mocks.transitioning = false;
  });

  it('searches with trimmed text and starts only visible eligible projects after confirmation', async () => {
    render(<Page />);
    await userEvent.type(screen.getByRole('searchbox', { name: '프로젝트 검색' }), '  mall  ');
    await userEvent.click(screen.getByRole('button', { name: '표시된 1개 켜기' }));
    expect(mocks.turnOnAll).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '1개 실행' }));
    expect(mocks.turnOnAll).toHaveBeenCalledWith([{ repo: 'org/mall', status: 'off' }]);
  });

  it('can recover from an empty search without reloading the page', async () => {
    render(<Page />);
    await userEvent.type(screen.getByRole('searchbox'), 'missing');
    expect(screen.getByText('조건에 맞는 프로젝트가 없습니다.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '필터 초기화' }));
    expect(screen.getByRole('button', { name: 'Mall 상세 보기' })).toBeInTheDocument();
  });

  it('provides an actionable retry after a list failure', async () => {
    mocks.error = 'network unavailable';
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it('allows refreshing a transition observed on initial load', async () => {
    mocks.transitioning = true;
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: '새로고침' }));
    expect(mocks.reload).toHaveBeenCalledOnce();
  });

  it('finds the title and service label actually displayed on the card', async () => {
    render(<Page />);
    const search = screen.getByRole('searchbox');
    await userEvent.type(search, 'Step Functions');
    expect(screen.getByRole('button', { name: 'Voice analytics 상세 보기' })).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'Voice analytics');
    expect(screen.getByRole('article')).toHaveAttribute('aria-label', 'Voice analytics');
  });
});
