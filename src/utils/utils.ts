import * as os from 'os';
import * as crypto from 'crypto';

let instanceKey: string;

export const getInstanceKey = () => {
  if (!instanceKey) {
    const data = `${os.hostname()}${__dirname}${process.env.NODE_CONFIG_ENV || process.env.NODE_ENV}`;
    instanceKey = crypto.createHash('md5').update(data).digest('hex');
  }
  return instanceKey;
};

export const getStreamKey = (stringId: string) => getInstanceKey() + stringId;

export const padR = (str: any, strLength: number, padSymbol: string = ' ') => {
  str = String(str || '');
  if (str.length < strLength) {
    str += padSymbol.repeat(Math.min(Math.max(0, strLength - str.length), 10000));
  }
  return str;
};

export const padL = (str: any, strLength: number, padSymbol: string = ' ') => {
  str = String(str == null ? '' : str);
  if (str.length < strLength) {
    str = padSymbol.repeat(Math.min(Math.max(0, strLength - str.length), 10000)) + str;
  }
  return str;
};

export const sleep = async (timeOut: number) => new Promise((resolve) => {
  const timer = setTimeout(() => {
    clearTimeout(timer);
    resolve(true);
  }, timeOut);
});

const rn = (x: number, digits: number = 2) => {
  const p = 10 ** digits;
  return Math.round(Number(x) * p) / p;
};

const mb = (bytes: number): string => `${rn(bytes / 1024 / 1024)} mb`;

export const memUsage = (): string => {
  const { heapUsed, rss } = process.memoryUsage();
  return `MEM: ${mb(heapUsed)} / ${mb(rss)}`;
};

export const timeParamRE = /^(\d+)\s*(years?|y|months?|mo|weeks?|w|days?|d|hours?|h|minutes?|min|m|seconds?|sec|s|milliseconds?|millis|ms|)$/i;

export const getTimeParamMillis = (val: string | number): number => {
  const [, nn, dhms] = timeParamRE.exec(String(val) || '') || [];
  if (!nn) {
    return 0;
  }
  let sec = 0;

  switch (dhms.toLowerCase()) {
    case 'y':
    case 'year':
    case 'years':
      sec = 365 * 24 * 3600 * +nn;
      break;
    case 'mo':
    case 'month':
    case 'months':
      sec = 30 * 24 * 3600 * +nn;
      break;
    case 'w':
    case 'week':
    case 'weeks':
      sec = 7 * 24 * 3600 * +nn;
      break;
    case 'd':
    case 'day':
    case 'days':
      sec = 24 * 3600 * +nn;
      break;
    case 'h':
    case 'hour':
    case 'hours':
      sec = 3600 * +nn;
      break;
    case 'm':
    case 'min':
    case 'minute':
    case 'minutes':
      sec = 60 * +nn;
      break;
    case 's':
    case 'sec':
    case 'second':
    case 'seconds':
      sec = +nn;
      break;
    case 'ms':
    case 'millis':
    case 'millisecond':
    case 'milliseconds':
      return +nn;
    default:
      return +nn;
  }
  return sec * 1000;
};

export const getTimeParamFromMillis = (millis: number, roundTo: 'd' | 'h' | 'm' | 's' | 'biggest' | '' = ''): string => {
  let seconds = millis < 1000 ? 0 : Math.floor(millis / 1000);
  if (roundTo === 's') {
    return `${seconds} s`;
  }
  millis %= 1000;
  let minutes = seconds < 60 ? 0 : Math.floor(seconds / 60);
  if (roundTo === 'm') {
    return `${minutes} m`;
  }
  seconds %= 60;
  let hours = minutes < 60 ? 0 : Math.floor(minutes / 60);
  if (roundTo === 'h') {
    return `${hours} h`;
  }
  minutes %= 60;
  const days = hours < 24 ? 0 : Math.floor(hours / 24);
  if (roundTo === 'd') {
    return `${days} d`;
  }
  hours %= 24;
  if (roundTo === 'biggest') {
    if (days) {
      return `${days} d`;
    }
    if (hours) {
      return `${hours} h`;
    }
    if (minutes) {
      return `${minutes} m`;
    }
    if (seconds) {
      return `${seconds} s`;
    }
    return `${millis} ms`;
  }
  if (millis) {
    return `${millis + seconds * 1000 + minutes * 60_000 + hours * 60 * 60_000 + days * 24 * 60 * 60_000} ms`;
  }
  if (seconds) {
    return `${seconds + minutes * 60 + hours * 60 * 60 + days * 24 * 60 * 60} s`;
  }
  if (minutes) {
    return `${minutes + hours * 60 + days * 24 * 60} m`;
  }
  if (hours) {
    return `${hours + days * 24} h`;
  }
  return `${days} d`;
};

export const cloneDeep = <T = any> (
  obj: any,
  options: { pureObj?: boolean, skipSymbols?: boolean } = {},
  hash = new WeakMap(),
): T => {
  // https://stackoverflow.com/a/40294058/5239731
  const { pureObj = false, skipSymbols = false } = options;
  if (Object(obj) !== obj) return obj; // primitives
  if (hash.has(obj)) return hash.get(obj); // cyclic reference
  let result;
  if (obj instanceof Set) {
    result = new Set(obj); // See note about this!
  } else if (obj instanceof Map) {
    result = new Map(Array.from(obj, ([key, val]) => [key, cloneDeep(val, options, hash)]));
  } else if (obj instanceof Date) {
    result = new Date(obj);
  } else if (obj instanceof RegExp) {
    result = new RegExp(obj.source, obj.flags);
  } else if (obj instanceof Function) {
    result = obj;
  } else if (!pureObj && obj.constructor) {
    result = new obj.constructor();
  } else {
    result = Object.create(null);
  }
  hash.set(obj, result);
  const keys = [...Object.keys(obj), ...(skipSymbols ? [] : Object.getOwnPropertySymbols(obj))];
  return Object.assign(result, ...keys.map(
    (key) => ({ [key]: cloneDeep(obj[key], options, hash) }),
  ));
};

export const getBool = (v: any, def = false): boolean => {
  if (v == null) {
    return def;
  }
  if (typeof v === 'string') {
    if (/^(false|0|no|нет)$/i.test(v)) {
      return false;
    }
    if (/^(true|1|yes|да)$/i.test(v)) {
      return true;
    }
    return def;
  }
  if (typeof v === 'boolean') {
    return v;
  }
  if (typeof v === 'number') {
    return !!v;
  }
  return !!v;
};

export const floatEnv = (name: string, def: number) => {
  let v = process.env[name];
  if (!v) {
    return def;
  }
  v = v.replace(/_/g, '');
  const val = parseFloat(v);
  return val || val === 0 ? val : def;
};

export const intEnv = (name: string, def: number) => Math.ceil(floatEnv(name, def));

export const strEnv = (name: string, def: string) => process.env[name] || def;

export const boolEnv = (name: string, def = false) => getBool(process.env[name], def);

/*
export const getBool = (v: any): boolean => {
  if (typeof v === 'string') {
    return /^(true|1|yes)$/i.test(v);
  }
  return !!v;
};

export const copyRecord = (record: TDbRecord): TDbRecord => {
  const recordCopy = { ...record };
  Object.entries(recordCopy).forEach(([key, value]) => {
    if (value && typeof value !== 'object') {
      if (value instanceof Date) {
        recordCopy[key] = Number(value);
      } else {
        try {
          recordCopy[key] = JSON.parse(JSON.stringify(value));
        } catch (err) {
          //
        }
      }
    }
  });
  return recordCopy;
};
*/
