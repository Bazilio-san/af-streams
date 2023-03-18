export const getBool = (v: any): boolean => {
  if (typeof v === 'string') {
    return /^(true|1|yes)$/i.test(v);
  }
  return !!v;
};

export const TS_FIELD = '__ts__';
export const STREAM_ID_FIELD = '__streamId__';
export const MILLIS_IN_DAY = 86_400_000;
export const MILLIS_IN_HOUR = 3_600_000;
export const MIN_WINDOW_MILLIS = 2;

// VVQ
const DEBUG = (String(process.env.DEBUG || '')).trim();
const isTotalDebug = DEBUG === '*';
const isTotalStreamDebug = isTotalDebug || /\baf-streams:?\*/i.test(DEBUG);

export const DEBUG_SQL = isTotalStreamDebug || /\baf-streams:sql\b/i.test(DEBUG); // Portion SQL
export const DEBUG_LTR = isTotalStreamDebug || /\baf-streams:ltr\b/i.test(DEBUG); // LastTimeRecords
export const DEBUG_LNP = isTotalStreamDebug || /\baf-streams:lnp\b/i.test(DEBUG); // before & after load next portion
export const DEBUG_STREAM = isTotalStreamDebug || /\baf-streams:stream\b/i.test(DEBUG);

export const PRINT_EVERY_REMOVED_ITEM_FROM_KEYED_SINGLE_EVENT_TIME_WINDOW = getBool(process.env.PRINT_EVERY_REMOVED_ITEM_FROM_KEYED_SINGLE_EVENT_TIME_WINDOW);
