import { TSlot } from '../interfaces';

export const findSlotIntLEFT = (arr: number[], x: number): TSlot => {
  const lastIndex = arr.length - 1;
  if (lastIndex < 0) {
    return [null, null, null];
  }
  const index = arr.findIndex((v) => v >= x);
  if (index > -1) {
    if (arr[index] === x) {
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

export const findSlotIntRIGHT = (arr: number[], x: number): TSlot => {
  const { length } = arr;
  if (!length) {
    return [null, null, null];
  }
  let pos = length;
  const lastIndex = length - 1;
  while (--pos >= 0) {
    const v = arr[pos];
    if (v === x) {
      return [
        pos === 0 ? null : pos - 1,
        pos,
        pos === lastIndex ? null : pos + 1,
      ];
    }
    if (v < x) {
      return [
        pos,
        null,
        pos === lastIndex ? null : pos + 1,
      ];
    }
  }
  return [null, null, 0];
};

export const findSlotIntBINARY = (arr: number[], x: number): TSlot => {
  const { length } = arr;
  if (!length) {
    return [null, null, null];
  }
  const lastIndex = length - 1;
  let start = 0;
  let end = length;
  if (x < arr[0]) {
    return [null, null, 0];
  }
  if (x === arr[0]) {
    return [null, 0, length > 1 ? 1 : null];
  }
  if (x > arr[lastIndex]) {
    return [lastIndex, null, null];
  }
  if (x === arr[lastIndex]) {
    return [lastIndex ? lastIndex - 1 : null, lastIndex, null];
  }
  let mid = 0;
  while (start <= end) {
    mid = Math.floor((start + end) / 2);
    if (arr[mid] === x) {
      return [
        mid === 0 ? null : mid - 1,
        mid,
        mid === length - 1 ? null : mid + 1,
      ];
    }
    if (arr[mid] > x) {
      end = mid - 1;
    } else {
      start = mid + 1;
    }
  }
  if (arr[mid] < x) {
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
 * Searches for a place for an integer (x) in an array of integers (arr) sorted in ascending order.
 * Returns an array of 3 indices:
 [
  <index of nearest smaller number | null>,
  <index of number equal to desired | null>,
  <index of nearest larger number | null>
 ]
 */
export const findSlotInt = (arr: number[], x: number): TSlot => {
  const { length } = arr;
  if (!length) {
    return [null, null, null];
  }
  if (length > 2000) {
    return findSlotIntBINARY(arr, x);
  }
  return ((arr[length - 1] - arr[0]) / 2) < x
    ? findSlotIntRIGHT(arr, x)
    : findSlotIntLEFT(arr, x);
};
