import { describe, it, expect } from 'vitest';
import { PACKAGE_VERSION } from '../index.js';

describe('shared package sanity', () => {
  it('exports a version constant', () => {
    expect(PACKAGE_VERSION).toBe('0.0.1');
  });
});
