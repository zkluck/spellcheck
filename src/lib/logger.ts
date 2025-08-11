const noop = () => {};

type Level = 'debug' | 'info' | 'warn' | 'error';

const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && !!process.versions?.node;
const isProduction = process.env.NODE_ENV === 'production';

// ENV config
const LOG_TO_FILE = (process.env.LOG_TO_FILE ?? (isNode ? 'true' : 'false')).toLowerCase() === 'true';
const LOG_DIR = process.env.LOG_DIR || 'logs';
const LOG_FILE_PREFIX = process.env.LOG_FILE_PREFIX || 'app';
const LOG_FILE_LEVEL = (process.env.LOG_FILE_LEVEL || 'info').toLowerCase() as Level;

function levelToNum(l: Level): number {
  switch (l) {
    case 'debug': return 10;
    case 'info': return 20;
    case 'warn': return 30;
    case 'error': return 40;
  }
}
const fileLevelNum = levelToNum(LOG_FILE_LEVEL);

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function safeStringify(v: unknown): string {
  if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const logger = (() => {
  // Console methods (preserve original behavior)
  const consoleWriters: Record<Level, (...args: any[]) => void> = {
    debug: isProduction ? noop : console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  // File writer (Node only)
  let lastKey: string | null = null;
  let fs: typeof import('fs') | null = null;
  let path: typeof import('path') | null = null;

  async function ensureDirOnce(dir: string) {
    if (!fs || !path) return;
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch {
      // ignore
    }
  }

  function currentFilePath(now: Date): string | null {
    if (!path) return null;
    const key = dateKey(now);
    lastKey = key;
    return path.join(process.cwd(), LOG_DIR, `${LOG_FILE_PREFIX}-${key}.log`);
  }

  async function writeFileLine(level: Level, args: unknown[]) {
    if (!isNode || !LOG_TO_FILE) return;
    // skip if below file level
    if (levelToNum(level) < fileLevelNum) return;
    try {
      // lazy import to avoid bundling in client
      if (!fs || !path) {
        fs = await import('fs');
        path = await import('path');
        await ensureDirOnce(path.join(process.cwd(), LOG_DIR));
      }
      const now = new Date();
      const file = currentFilePath(now);
      if (!file || !fs) return;
      const line = [now.toISOString(), level.toUpperCase(), ...args.map(safeStringify)].join(' ') + '\n';
      // async append (non-blocking)
      fs.promises.appendFile(file, line).catch(() => {});
    } catch {
      // swallow file logging errors
    }
  }

  function write(level: Level, ...args: unknown[]) {
    // console first
    consoleWriters[level](...args as any);
    // then file
    void writeFileLine(level, args);
  }

  return {
    debug: (...args: unknown[]) => write('debug', ...args),
    info: (...args: unknown[]) => write('info', ...args),
    warn: (...args: unknown[]) => write('warn', ...args),
    error: (...args: unknown[]) => write('error', ...args),
  };
})();
