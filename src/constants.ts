export const TS_FIELD = '__ts__';
export const STREAM_ID_FIELD = '__streamId__';
export const MILLIS_IN_DAY = 86_400_000;
export const MILLIS_IN_HOUR = 3_600_000;
export const MIN_WINDOW_MILLIS = 2;

export const DEFAULTS = {
  FETCH_INTERVAL_SEC: 10,
  BUFFER_MULTIPLIER: 2,
  MAX_BUFFER_SIZE: 65_000,
  MAX_RUNUP_FIRST_TS_VT_MILLIS: 2_000,
  STREAM_SEND_INTERVAL_MILLIS: 10,
  TIME_FRONT_UPDATE_INTERVAL_MILLIS: 5,
  SPEED_CALC_INTERVAL_SEC: 10,
  SKIP_GAPS: false,
  PRINT_INFO_INTERVAL_SEC: 60,
  RECTIFIER_ACCUMULATION_TIME_MILLIS: 300_000,
  RECTIFIER_SEND_INTERVAL_MILLIS: 10,
  RECTIFIER_FIELD_NAME_TO_SORT: 'ts',
};

const DEBUG = (String(process.env.DEBUG || '')).trim();
const isTotalDebug = DEBUG === '*';
const isTotalStreamDebug = isTotalDebug || /\baf-streams:?\*/i.test(DEBUG);

export const DEBUG_SQL = isTotalStreamDebug || /\baf-streams:sql\b/i.test(DEBUG); // Portion SQL
export const DEBUG_LTR = isTotalStreamDebug || /\baf-streams:ltr\b/i.test(DEBUG); // LastTimeRecords
export const DEBUG_LNP = isTotalStreamDebug || /\baf-streams:lnp\b/i.test(DEBUG); // before & after load next portion
export const DEBUG_STREAM = isTotalStreamDebug || /\baf-streams:stream\b/i.test(DEBUG);
export const DEBUG_ALERTS_BUFFER = isTotalStreamDebug || /\baf-streams:alerts-buffer\b/i.test(DEBUG);

const getBool = (v: any): boolean => /^(true|1|yes)$/i.test(String(v));

// eslint-disable-next-line no-shadow
export enum EMailSendRule {
  IF_ALERT_NOT_EXISTS = 'IF_ALERT_NOT_EXISTS',
  BLOCK = 'BLOCK',
  FORCE = 'FORCE'
}

export const STREAMS_ENV = {
  EMAIL_SEND_RULE: EMailSendRule.IF_ALERT_NOT_EXISTS,
  NO_SAVE_HISTORY_ALERTS: false,
  PRINT_EVERY_REMOVED_ITEM_FROM_KEYED_SINGLE_EVENT_TIME_WINDOW: false,
};

// Через переменную окружения EMAIL_SEND_RULE Можно управлять правилом отправки
export const reloadStreamsEnv = () => {
  const rule = process.env.EMAIL_SEND_RULE as EMailSendRule;
  STREAMS_ENV.EMAIL_SEND_RULE = Object.values(EMailSendRule).includes(rule)
    ? rule
    : EMailSendRule.IF_ALERT_NOT_EXISTS;
  STREAMS_ENV.NO_SAVE_HISTORY_ALERTS = getBool(process.env.NO_SAVE_HISTORY_ALERTS);
  STREAMS_ENV.PRINT_EVERY_REMOVED_ITEM_FROM_KEYED_SINGLE_EVENT_TIME_WINDOW = getBool(process.env.PRINT_EVERY_REMOVED_ITEM_FROM_KEYED_SINGLE_EVENT_TIME_WINDOW);
};

reloadStreamsEnv();

export const isDeprecatedSendAlertsByEmail = () => STREAMS_ENV.EMAIL_SEND_RULE === EMailSendRule.BLOCK;
