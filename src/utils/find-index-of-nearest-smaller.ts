/* eslint-disable camelcase */
import { TS_FIELD } from '../constants';

export const findIndexOfNearestSmallerLEFT = (arr: any[], x: number, timeFieldName: string | symbol = TS_FIELD) => {
  if (!arr.length) {
    return -1;
  }
  const index = arr.findIndex((v) => v[timeFieldName] >= x);
  if (index > -1) {
    return index - 1;
  }
  if (x < arr[0][timeFieldName]) {
    return -1;
  }
  return arr.length - 1;
};

export const findIndexOfNearestSmallerRIGHT = (arr: any[], x: number, timeFieldName: string | symbol = TS_FIELD) => {
  let pos = arr.length;
  if (pos) {
    while (--pos >= 0) {
      if (arr[pos][timeFieldName] < x) {
        return pos;
      }
    }
  }
  return -1;
};

export const findIndexOfNearestSmallerBINARY = (arr: any[], x: number, timeFieldName: string | symbol = TS_FIELD) => {
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

export const findIndexOfNearestSmaller = (arr: any[], x: number, timeFieldName: string | symbol = TS_FIELD) => {
  const { length } = arr;
  if (!length) {
    return -1;
  }
  if (arr.length > 2000) {
    return findIndexOfNearestSmallerBINARY(arr, x, timeFieldName);
  }
  return ((arr[length - 1] - arr[0]) / 2) < x
    ? findIndexOfNearestSmallerRIGHT(arr, x, timeFieldName)
    : findIndexOfNearestSmallerLEFT(arr, x, timeFieldName);
};
