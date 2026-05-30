export class TransientError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(message);
    this.name = 'TransientError';
  }
}

export class PermanentError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(message);
    this.name = 'PermanentError';
  }
}

export class ConflictError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class AssumeRoleFailedError extends Error {
  constructor(public account: string, public reason: string) {
    super(`AssumeRole failed for ${account}: ${reason}`);
    this.name = 'AssumeRoleFailedError';
  }
}

const TRANSIENT_NAMES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailable',
  'InternalServerError',
  'RequestTimeoutException',
  'TimeoutError',
  'NetworkingError',
]);

const PERMANENT_NAMES = new Set([
  'ResourceNotFoundException',
  'NoSuchEntity',
  'AccessDeniedException',
  'UnauthorizedException',
  'ValidationException',
  'InvalidParameterValue',
  'InvalidIdentityToken',
]);

const CONFLICT_NAMES = new Set([
  'ConditionalCheckFailedException',
  'ResourceInUseException',
  'ConcurrentModificationException',
]);

export function classifyAwsError(err: unknown): Error {
  if (!(err instanceof Error)) {
    return new PermanentError(String(err));
  }
  const name = (err as { name?: string }).name ?? '';
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

  if (TRANSIENT_NAMES.has(name) || (status !== undefined && status >= 500)) {
    return new TransientError(err.message, err);
  }
  if (CONFLICT_NAMES.has(name)) {
    return new ConflictError(err.message, err);
  }
  if (PERMANENT_NAMES.has(name) || (status !== undefined && status >= 400 && status < 500)) {
    return new PermanentError(err.message, err);
  }
  return new PermanentError(err.message, err);
}
