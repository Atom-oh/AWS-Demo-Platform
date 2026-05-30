import { createLogger, type Logger } from '@demo-platform/shared';

const log: Logger = createLogger({ name: 'worker' });

if (import.meta.url === `file://${process.argv[1]}`) {
  log.info('worker stub starting');
}

export { log };
