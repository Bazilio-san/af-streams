import * as os from 'os';
import * as crypto from 'crypto';

export const findSmallestIndexLinear = (arr: any[], x: number, timeFieldName: string) => {
  if (!arr.length) {
    return -1;
  }
  const index = arr.findIndex((v) => v[timeFieldName] >= x);
  if (index > -1) {
    return index - 1;
  }
  if (arr[0][timeFieldName] > x) { // Это условие не выполняется никогда
    return -1;
  }
  return arr.length - 1;
};

export const findSmallestIndexBinary = (arr: any[], x: number, timeFieldName: string) => {
  let start = 0;
  let end = arr.length - 1;
  let ans = -1;
  while (start <= end) {
    const mid = Math.floor((start + end) / 2);
    if (arr[mid][timeFieldName] === x) {
      return mid - 1;
    }
    if (arr[mid][timeFieldName] > x) {
      end = mid - 1;
    } else {
      ans = mid;
      start = mid + 1;
    }
  }
  return ans;
};

export const findSmallestIndex = (arr: any[], x: number, timeFieldName: string) => {
  if (arr.length < 50000) {
    return findSmallestIndexLinear(arr, x, timeFieldName);
  }
  return findSmallestIndexBinary(arr, x, timeFieldName);
};

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
  str = String(str || '');
  if (str.length < strLength) {
    str = padSymbol.repeat(Math.min(Math.max(0, strLength - str.length), 10000)) + str;
  }
  return str;
};

export const sleep = async (timeOut: number) => new Promise((resolve) => {
  setTimeout(resolve, timeOut);
});
