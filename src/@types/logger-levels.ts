export interface ILogLevel {
  0: 'silly';
  1: 'trace';
  2: 'debug';
  3: 'info';
  4: 'warn';
  5: 'error';
  6: 'fatal';
}
/**
 * Log level IDs (0 - 6)
 * @public
 */
export type TLogLevelId = keyof ILogLevel;

/**
 * Log level names (silly - fatal)
 * @public
 */
export type TLogLevelName = ILogLevel[TLogLevelId];
