/*
 * 轻量日志工具：在服务端使用 console，但规范化字段，便于后续接入专业日志库
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogFields {
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, fields?: LogFields) {
  const base = {
    level,
    message,
    time: new Date().toISOString(),
    ...fields,
  } as const;
  // 统一使用 console，后续可替换为 pino/winston
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(base);
  } else if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(base);
  } else if (level === 'info') {
    // eslint-disable-next-line no-console
    console.info(base);
  } else {
    // eslint-disable-next-line no-console
    console.debug(base);
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields) => log('debug', message, fields),
  info: (message: string, fields?: LogFields) => log('info', message, fields),
  warn: (message: string, fields?: LogFields) => log('warn', message, fields),
  error: (message: string, fields?: LogFields) => log('error', message, fields),
};
