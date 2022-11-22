export const TS_FIELD = Symbol.for('TS_FIELD');
export const MILLIS_IN_DAY = 86_400_000;
export const MILLIS_IN_HOUR = 3_600_000;

const DEBUG = (String(process.env.DEBUG || '')).trim();
export const DEBUG_SQL = /\baf-streams:sql\b/i.test(DEBUG); // Portion SQL
export const DEBUG_LTR = /\baf-streams:ltr\b/i.test(DEBUG); // LastTimeRecords
export const DEBUG_LNP = /\baf-streams:lnp\b/i.test(DEBUG); // before & after load next portion
export const DEBUG_STREAM = /\baf-streams:stream\b/i.test(DEBUG);
