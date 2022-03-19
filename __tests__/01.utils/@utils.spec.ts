import * as U from '../../src/utils/utils';
import { TS_FIELD } from '../../src';

const data = require('./data.json');

const data2 = [
  { ts: 10 },
];
const data3: any[] = [];

const perf = () => {
  [100, 200, 300, 600, 800, 1000, 2000, 3000, 5000].forEach((arrLen) => {
    const loops = [...Array(10000).keys()];
    const arr = [...Array(arrLen).keys()].map((i) => ({ [TS_FIELD]: i }));
    const ts = arrLen - 2;

    let start = Date.now();
    loops.forEach(() => {
      U.findSmallestIndexLinear(arr, ts);
    });
    const t1 = Date.now() - start;

    start = Date.now();
    loops.forEach(() => {
      U.findSmallestIndexBinary(arr, ts);
    });
    const t2 = Date.now() - start;

    start = Date.now();
    loops.forEach(() => {
      U.findIndexOfNearestSmallFromRight(arr, ts);
    });
    const t3 = Date.now() - start;

    console.log(`Length: ${arrLen} , Linear: ${t1}, Binary: ${t2}, Right: ${t3}`);
  });
};
perf();

describe('Utils. findSmallestIndex[Binary]()', () => {
  describe('arr1', () => {
    [
      [0, -1],
      [1, -1],
      [2, -1],
      [5, 2],
      [16, 13],
      [17, 14],
      [18, 15],
      [50, 15],
    ].forEach(([ts, expected]) => {
      test(`ts: ${ts}, result: ${expected}`, () => {
        const result = U.findSmallestIndexLinear(data, ts, 'ts');
        expect(result).toEqual(expected);
        const resultB = U.findSmallestIndexBinary(data, ts, 'ts');
        expect(resultB).toEqual(expected);
        const resultC = U.findIndexOfNearestSmallFromRight(data, ts, 'ts');
        expect(resultC).toEqual(expected);
      });
    });
  });
  describe('findSmallestIndex() 2', () => {
    [
      // [1, -1],
      [10, -1],
      [11, 0],
      [18, 0],
    ].forEach(([ts, expected]) => {
      test(`ts: ${ts}, result: ${expected}`, () => {
        const result = U.findSmallestIndexLinear(data2, ts, 'ts');
        expect(result).toEqual(expected);
        const resultB = U.findSmallestIndexBinary(data2, ts, 'ts');
        expect(resultB).toEqual(expected);
        const resultC = U.findIndexOfNearestSmallFromRight(data2, ts, 'ts');
        expect(resultC).toEqual(expected);
      });
    });
  });
  describe('findSmallestIndex() 3', () => {
    [
      [0, -1],
      [1, -1],
      [18, -1],
    ].forEach(([ts, expected]) => {
      test(`ts: ${ts}, result: ${expected}`, () => {
        const result = U.findSmallestIndexLinear(data3, ts, 'ts');
        expect(result).toEqual(expected);
        const resultB = U.findSmallestIndexBinary(data3, ts, 'ts');
        expect(resultB).toEqual(expected);
        const resultC = U.findIndexOfNearestSmallFromRight(data3, ts, 'ts');
        expect(resultC).toEqual(expected);
      });
    });
  });
});
