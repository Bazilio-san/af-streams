import { TSlot } from '../@types/interfaces';

export const eq = (a: number, b: number, SIGMA: number) => Math.abs(a - b) <= SIGMA;
export const gt = (a: number, b: number, SIGMA: number) => a > b + SIGMA;
export const lt = (a: number, b: number, SIGMA: number) => a < b - SIGMA;
export const gte = (a: number, b: number, SIGMA: number) => a >= b - SIGMA;
export const lte = (a: number, b: number, SIGMA: number) => a <= b + SIGMA;

export const findSlotFloatLEFT = (arr: number[], x: number, SIGMA: number): TSlot => {
  const lastIndex = arr.length - 1;
  if (lastIndex < 0) {
    return [null, null, null];
  }
  const index = arr.findIndex((v) => gte(v, x, SIGMA));
  if (index > -1) {
    if (eq(arr[index], x, SIGMA)) {
      return [
        index === 0 ? null : index - 1,
        index,
        index === lastIndex ? null : index + 1,
      ];
    } // x < arr[index]
    return [
      index === 0 ? null : index - 1,
      null,
      index,
    ];
  }
  // index === -1: X больше наибольшего
  return [lastIndex, null, null];
};

export const findSlotFloatRIGHT = (arr: number[], x: number, SIGMA: number): TSlot => {
  const { length } = arr;
  if (!length) {
    return [null, null, null];
  }
  let pos = length;
  const lastIndex = length - 1;
  while (--pos >= 0) {
    const v = arr[pos];
    if (eq(v, x, SIGMA)) {
      return [
        pos === 0 ? null : pos - 1,
        pos,
        pos === lastIndex ? null : pos + 1,
      ];
    }
    if (lt(v, x, SIGMA)) {
      return [
        pos,
        null,
        pos === lastIndex ? null : pos + 1,
      ];
    }
  }
  return [null, null, 0];
};

export const findSlotFloatBINARY = (arr: number[], x: number, SIGMA: number): TSlot => {
  const { length } = arr;
  if (!length) {
    return [null, null, null];
  }
  const lastIndex = length - 1;
  let start = 0;
  let end = length;
  if (lt(x, arr[0], SIGMA)) {
    return [null, null, 0];
  }
  if (eq(x, arr[0], SIGMA)) {
    return [null, 0, length > 1 ? 1 : null];
  }
  if (gt(x, arr[lastIndex], SIGMA)) {
    return [lastIndex, null, null];
  }
  if (eq(x, arr[lastIndex], SIGMA)) {
    return [lastIndex ? lastIndex - 1 : null, lastIndex, null];
  }
  let mid = 0;
  while (start <= end) {
    mid = Math.floor((start + end) / 2);
    if (eq(arr[mid], x, SIGMA)) {
      return [
        mid === 0 ? null : mid - 1,
        mid,
        mid === length - 1 ? null : mid + 1,
      ];
    }
    if (gt(arr[mid], x, SIGMA)) {
      end = mid - 1;
    } else {
      start = mid + 1;
    }
  }
  if (lt(arr[mid], x, SIGMA)) {
    return [
      mid,
      null,
      length > 1 ? mid + 1 : null,
    ];
  }
  return [
    length > 1 ? mid - 1 : null,
    null,
    mid,
  ];
};

/**
 * Searches for a place for a float number (x) in an array of float numbers (arr) sorted in ascending order.
 * Returns an array of 3 indices:
 [
 <index of nearest smaller number | null>,
 <index of number equal to desired | null>,
 <index of nearest larger number | null>
 ]
 Numbers are compared using SIGMA: if the numbers differ by less than SIGMA, then they are considered equal.
 */
export const findSlotFloat = (arr: number[], x: number, SIGMA: number): TSlot => {
  const { length } = arr;
  if (!length) {
    return [null, null, null];
  }
  if (length > 2000) {
    return findSlotFloatBINARY(arr, x, SIGMA);
  }
  return ((arr[length - 1] - arr[0]) / 2) < x
    ? findSlotFloatRIGHT(arr, x, SIGMA)
    : findSlotFloatLEFT(arr, x, SIGMA);
};
