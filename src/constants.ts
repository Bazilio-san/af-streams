export const TS_FIELD = '__ts__';
export const STREAM_ID_FIELD = '__streamId__';
export const MILLIS_IN_DAY = 86_400_000;
export const MILLIS_IN_HOUR = 3_600_000;
export const MIN_WINDOW_MILLIS = 2;

const DEBUG = (String(process.env.DEBUG || '')).trim();
const isTotalDebug = DEBUG === '*';
const isTotalStreamDebug = isTotalDebug || /\baf-streams:?\*/i.test(DEBUG);

export const DEBUG_SQL = isTotalStreamDebug || /\baf-streams:sql\b/i.test(DEBUG); // Portion SQL
export const DEBUG_LTR = isTotalStreamDebug || /\baf-streams:ltr\b/i.test(DEBUG); // LastTimeRecords
export const DEBUG_LNP = isTotalStreamDebug || /\baf-streams:lnp\b/i.test(DEBUG); // before & after load next portion
export const DEBUG_STREAM = isTotalStreamDebug || /\baf-streams:stream\b/i.test(DEBUG);
export const DEBUG_ALERTS_BUFFER = isTotalStreamDebug || /\baf-streams:alerts\b/i.test(DEBUG);

export const STREAM_CONFIG_DEFAULTS = { timeDelayMillis: 0 };
