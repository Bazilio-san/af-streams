/* istanbul ignore file */
// noinspection JSUnusedGlobalSymbols

import { getAFLogger } from 'af-logger';
import { TLogLevelName } from 'tslog';
import emitter from './ee';

const prefix = 'af-stream';
const minLevel = process.env.LOGGER_LEVEL || 'silly';

const { logger, fileLogger, exitOnError, echo, color } = getAFLogger({
  minLevel: minLevel as TLogLevelName,
  name: prefix,
  filePrefix: prefix,
  // logDir,
  minLogSize: 0,
  minErrorLogSize: 0,
  emitter,
  fileLoggerMap: {
    silly: 'info',
    info: 'info',
    error: 'error',
    fatal: 'error',
  },
});

// const { info, error, loggerFinish } = fileLogger
export { logger, fileLogger, exitOnError, echo, color };
