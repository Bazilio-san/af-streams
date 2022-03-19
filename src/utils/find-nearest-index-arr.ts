export const findSmallestIndexLinearARR = (arr: number[], x: number) => {
  if (!arr.length) {
    return -1;
  }
  const index = arr.findIndex((v) => v >= x);
  if (index > -1) {
    return index - 1;
  }
  if (x < arr[0]) {
    return -1;
  }
  return arr.length - 1;
};

export const findIndexOfNearestSmallFromRightARR = (arr: number[], x: number) => {
  let pos = arr.length;
  if (pos) {
    while (--pos >= 0) {
      if (arr[pos] < x) {
        return pos;
      }
    }
  }
  return -1;
};

export const findSmallestIndexBinaryARR = (arr: number[], x: number) => {
  let start = 0;
  let end = arr.length - 1;
  let ans = -1;
  while (start <= end) {
    const mid = Math.floor((start + end) / 2);
    if (arr[mid] === x) {
      return mid - 1;
    }
    if (arr[mid] > x) {
      end = mid - 1;
    } else {
      ans = mid;
      start = mid + 1;
    }
  }
  return ans;
};

export const findSmallestIndexARR = (arr: number[], x: number, fromRight: boolean = false) => {
  if (arr.length < 2000) {
    return fromRight ? findIndexOfNearestSmallFromRightARR(arr, x) : findSmallestIndexLinearARR(arr, x);
  }
  return findSmallestIndexBinaryARR(arr, x);
};
