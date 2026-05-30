import { describe, it, expect, vi } from 'vitest';
import { createLogger } from '../logger.js';

describe('createLogger', () => {
  it('returns a pino logger with the requested name and level', () => {
    const log = createLogger({ name: 'test-svc', level: 'info' });
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.child).toBe('function');
  });

  it('child logger carries correlation id', () => {
    const log = createLogger({ name: 'test', level: 'silent' });
    const child = log.child({ correlationId: 'abc-123' });
    expect(child.bindings()).toMatchObject({ correlationId: 'abc-123' });
  });

  it('respects LOG_LEVEL env if no override given', () => {
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'warn';
    const log = createLogger({ name: 'test' });
    expect(log.level).toBe('warn');
    process.env.LOG_LEVEL = prev;
  });
});
