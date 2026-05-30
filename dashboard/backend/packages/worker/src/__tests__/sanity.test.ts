import { describe, it, expect } from 'vitest';
import { log } from '../index.js';

describe('worker sanity', () => {
  it('exposes a logger', () => {
    expect(typeof log.info).toBe('function');
  });
});
