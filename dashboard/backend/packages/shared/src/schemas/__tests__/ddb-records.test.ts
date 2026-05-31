import { describe, it, expect } from 'vitest';
import {
  StateRecordSchema,
  JobRecordSchema,
  HistoryRecordSchema,
  ProjectStatus,
  JobStatus,
} from '../ddb-records.js';

describe('StateRecordSchema', () => {
  it('parses minimal on-state record', () => {
    const rec = StateRecordSchema.parse({
      pk: 'project#api-playground',
      sk: 'current',
      status: 'on',
      updated_at: '2026-05-28T00:00:00Z',
    });
    expect(rec.status).toBe('on');
  });

  it('requires restoration_data for status=off', () => {
    expect(() =>
      StateRecordSchema.parse({
        pk: 'project#x',
        sk: 'current',
        status: 'off',
        updated_at: '2026-05-28T00:00:00Z',
      }),
    ).toThrow(/restoration_data/);
  });

  it('rejects invalid status', () => {
    expect(() =>
      StateRecordSchema.parse({
        pk: 'project#x',
        sk: 'current',
        status: 'paused',
        updated_at: '2026-05-28T00:00:00Z',
      }),
    ).toThrow();
  });
});

describe('JobRecordSchema', () => {
  it('parses pending job', () => {
    const rec = JobRecordSchema.parse({
      pk: 'job#abc-123',
      gsi1pk: 'project#api',
      gsi1sk: '2026-05-28T00:00:00Z',
      operation: 'turn_off',
      status: 'pending',
      progress: {},
      created_at: '2026-05-28T00:00:00Z',
      ttl: 1759190400,
    });
    expect(rec.status).toBe('pending');
  });

  it('all JobStatus values parsed', () => {
    for (const s of JobStatus.options) {
      JobRecordSchema.parse({
        pk: 'job#a',
        gsi1pk: 'project#a',
        gsi1sk: '2026-01-01T00:00:00Z',
        operation: 'turn_off',
        status: s,
        progress: {},
        created_at: '2026-01-01T00:00:00Z',
        ttl: 100,
      });
    }
  });
});

describe('HistoryRecordSchema', () => {
  it('parses history entry', () => {
    const rec = HistoryRecordSchema.parse({
      pk: 'project#api',
      sk: '2026-05-28T00:00:00Z#abc-123',
      action: 'turn_off',
      actor: 'atomoh',
      account: 'atomoh-main',
      result: 'success',
      details: { ecs: 'done' },
      ttl: 1762000000,
    });
    expect(rec.result).toBe('success');
  });
});

describe('ProjectStatus enum', () => {
  it('exposes on/off/transitioning/error', () => {
    expect(ProjectStatus.options).toEqual(['on', 'off', 'transitioning', 'error']);
  });
});
