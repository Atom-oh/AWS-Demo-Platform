import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatStrip } from '@/components/StatStrip';
import type { ProjectRow } from '@/lib/types';

const rows: ProjectRow[] = [
  { repo: 'org/a', name: 'a', account: 'acc-1', project: null, status: 'on' },
  { repo: 'org/b', name: 'b', account: 'acc-2', project: null, status: 'off' },
];

describe('StatStrip', () => {
  it('renders project/account/on/off counts from the given rows', () => {
    render(<StatStrip rows={rows} />);
    // rows.length=2 and distinct accounts=2 both render "2"; on=1 and off=1 both render "1".
    expect(screen.getAllByText('2')).toHaveLength(2);
    expect(screen.getAllByText('1')).toHaveLength(2);
  });
});
