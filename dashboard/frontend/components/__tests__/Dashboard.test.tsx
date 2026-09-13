import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Page from '@/app/page';
import type { ProjectRow } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  toggle: vi.fn(async () => ({ ok: true })),
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
  { repo: 'org/alert', name: 'Alert', account: 'one', project: null, status: 'error' },
];
vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({
    rows: mocks.transitioning ? rows.map((r) => ({ ...r, status: 'transitioning' })) : rows,
    loading: false, error: mocks.error, reload: mocks.reload,
    toggle: mocks.toggle, scale: vi.fn(),
  }),
}));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock('@/components/LoginGate', () => ({
  LoginGate: ({ children }: { children: React.ReactNode }) => children,
}));

describe('Dashboard discovery and bulk scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toggle.mockReset().mockResolvedValue({ ok: true });
    mocks.error = null;
    mocks.transitioning = false;
  });

  it('searches with trimmed text and starts only visible eligible projects after confirmation', async () => {
    render(<Page />);
    await userEvent.type(screen.getByRole('searchbox', { name: '프로젝트 검색' }), '  mall  ');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mall 선택' }));
    await userEvent.click(screen.getByRole('button', { name: '선택 1개 켜기' }));
    expect(mocks.toggle).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '1개 실행' }));
    expect(mocks.toggle.mock.calls[0].slice(0, 2)).toEqual(['org/mall', 'turn_on']);
    expect(mocks.toggle).toHaveBeenCalledOnce();
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
    expect(screen.getByRole('row', { name: /Voice analytics/ })).toBeInTheDocument();
  });

  it('defaults to an attention-first table and clears hidden selections when filters change', async () => {
    render(<Page />);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Alert');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mall 선택' }));
    await userEvent.type(screen.getByRole('searchbox'), 'Voice');
    expect(screen.getByRole('button', { name: '선택 0개 켜기' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Voice analytics 선택' })).not.toBeChecked();
  });

  it('confirms a selected shutdown and retries only failed projects', async () => {
    mocks.toggle.mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    render(<Page />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Live 선택' }));
    await userEvent.click(screen.getByRole('button', { name: '선택 1개 끄기' }));
    expect(screen.getByRole('region', { name: '일괄 실행 확인' })).toHaveTextContent('Live (org/live)');
    await userEvent.click(screen.getByRole('button', { name: '1개 실행' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '실패 1개 재시도' })).toBeEnabled());
    const panel = screen.getByRole('region', { name: '일괄 작업 결과' });
    expect(within(panel).getByText('실패 또는 결과 미확인')).toBeVisible();
    await userEvent.click(within(panel).getByRole('button', { name: '실패 1개 재시도' }));
    await userEvent.click(screen.getByRole('button', { name: '1개 실행' }));
    await waitFor(() => expect(mocks.toggle).toHaveBeenCalledTimes(2));
    expect(mocks.toggle.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['org/live', 'turn_off'], ['org/live', 'turn_off'],
    ]);
  });
});
