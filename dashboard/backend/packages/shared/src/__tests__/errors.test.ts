import { describe, it, expect } from 'vitest';
import {
  TransientError,
  PermanentError,
  ConflictError,
  AssumeRoleFailedError,
  classifyAwsError,
} from '../errors.js';

describe('error classes', () => {
  it('TransientError preserves message and name', () => {
    const e = new TransientError('throttled');
    expect(e.message).toBe('throttled');
    expect(e.name).toBe('TransientError');
    expect(e).toBeInstanceOf(Error);
  });

  it('PermanentError is distinguishable from TransientError', () => {
    const e = new PermanentError('not found');
    expect(e).toBeInstanceOf(PermanentError);
    expect(e).not.toBeInstanceOf(TransientError);
  });

  it('ConflictError carries optional retryable hint', () => {
    const e = new ConflictError('busy');
    expect(e.name).toBe('ConflictError');
  });

  it('AssumeRoleFailedError carries account and reason', () => {
    const e = new AssumeRoleFailedError('atomoh-main', 'invalid external id');
    expect(e.message).toMatch(/atomoh-main/);
    expect(e.message).toMatch(/invalid external id/);
  });
});

describe('classifyAwsError', () => {
  it('classifies ThrottlingException as Transient', () => {
    const err = Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
    expect(classifyAwsError(err)).toBeInstanceOf(TransientError);
  });

  it('classifies ResourceNotFoundException as Permanent', () => {
    const err = Object.assign(new Error('nope'), { name: 'ResourceNotFoundException' });
    expect(classifyAwsError(err)).toBeInstanceOf(PermanentError);
  });

  it('classifies ConditionalCheckFailedException as Conflict', () => {
    const err = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
    expect(classifyAwsError(err)).toBeInstanceOf(ConflictError);
  });

  it('returns Transient for 5xx status code', () => {
    const err = Object.assign(new Error('500'), { $metadata: { httpStatusCode: 503 } });
    expect(classifyAwsError(err)).toBeInstanceOf(TransientError);
  });

  it('defaults to PermanentError for unknown error', () => {
    const err = new Error('whatever');
    expect(classifyAwsError(err)).toBeInstanceOf(PermanentError);
  });
});
