import pino, { type Logger, type LoggerOptions } from 'pino';

export interface LoggerConfig {
  name: string;
  level?: pino.Level;
}

export function createLogger(config: LoggerConfig): Logger {
  const level: pino.Level =
    config.level ?? (process.env.LOG_LEVEL as pino.Level | undefined) ?? 'info';

  const options: LoggerOptions = {
    name: config.name,
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  return pino(options);
}

export type { Logger };
