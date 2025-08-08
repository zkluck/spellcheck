const noop = () => {};

const createLogger = () => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    debug: isProduction ? noop : console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
};

export const logger = createLogger();
