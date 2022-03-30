import {
  findIndexOfNearestSmallerRIGHT,
  findIndexOfNearestSmallerInNumArrayRIGHT,
  findIndexOfNearestSmallerInNumArray,
  findIndexOfNearestSmallerBINARY,
  findIndexOfNearestSmallerInNumArrayBINARY,
  findIndexOfNearestSmallerLEFT,
  findIndexOfNearestSmallerInNumArrayLEFT,
  TS_FIELD,
} from '../../src';

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
      findIndexOfNearestSmallerLEFT(arr, ts);
    });
    const t1 = Date.now() - start;

    start = Date.now();
    loops.forEach(() => {
      findIndexOfNearestSmallerBINARY(arr, ts);
    });
    const t2 = Date.now() - start;

    start = Date.now();
    loops.forEach(() => {
      findIndexOfNearestSmallerRIGHT(arr, ts);
    });
    const t3 = Date.now() - start;

    // eslint-disable-next-line no-console
    console.log(`Length: ${arrLen} , Linear: ${t1}, Binary: ${t2}, Right: ${t3}`);
  });
};
perf();

describe('findIndexOfNearestSmaller', () => {
  describe('OBJ', () => {
    describe('sample 1', () => {
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
          const result = findIndexOfNearestSmallerLEFT(data, ts, 'ts');
          expect(result).toEqual(expected);
          const resultB = findIndexOfNearestSmallerBINARY(data, ts, 'ts');
          expect(resultB).toEqual(expected);
          const resultC = findIndexOfNearestSmallerRIGHT(data, ts, 'ts');
          expect(resultC).toEqual(expected);
        });
      });
    });
    describe('sample 2', () => {
      [
        // [1, -1],
        [10, -1],
        [11, 0],
        [18, 0],
      ].forEach(([ts, expected]) => {
        test(`ts: ${ts}, result: ${expected}`, () => {
          const result = findIndexOfNearestSmallerLEFT(data2, ts, 'ts');
          expect(result).toEqual(expected);
          const resultB = findIndexOfNearestSmallerBINARY(data2, ts, 'ts');
          expect(resultB).toEqual(expected);
          const resultC = findIndexOfNearestSmallerRIGHT(data2, ts, 'ts');
          expect(resultC).toEqual(expected);
        });
      });
    });
    describe('sample 3', () => {
      [
        [0, -1],
        [1, -1],
        [18, -1],
      ].forEach(([ts, expected]) => {
        test(`ts: ${ts}, result: ${expected}`, () => {
          const result = findIndexOfNearestSmallerLEFT(data3, ts, 'ts');
          expect(result).toEqual(expected);
          const resultB = findIndexOfNearestSmallerBINARY(data3, ts, 'ts');
          expect(resultB).toEqual(expected);
          const resultC = findIndexOfNearestSmallerRIGHT(data3, ts, 'ts');
          expect(resultC).toEqual(expected);
        });
      });
    });
  });

  describe('ARR', () => {
    describe('sample 1', () => {
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
          const data_ = data.map(({ ts: t }: any) => t);
          expect(findIndexOfNearestSmallerInNumArrayLEFT(data_, ts)).toEqual(expected);
          expect(findIndexOfNearestSmallerInNumArrayBINARY(data_, ts)).toEqual(expected);
          expect(findIndexOfNearestSmallerInNumArrayRIGHT(data_, ts)).toEqual(expected);
          expect(findIndexOfNearestSmallerInNumArray(data_, ts)).toEqual(expected);
        });
      });
    });
    describe('sample 2', () => {
      [
        // [1, -1],
        [10, -1],
        [11, 0],
        [18, 0],
      ].forEach(([ts, expected]) => {
        test(`ts: ${ts}, result: ${expected}`, () => {
          const data2_ = [10];
          expect(findIndexOfNearestSmallerInNumArrayLEFT(data2_, ts)).toEqual(expected);
          expect(findIndexOfNearestSmallerInNumArrayBINARY(data2_, ts)).toEqual(expected);
          expect(findIndexOfNearestSmallerInNumArrayRIGHT(data2_, ts)).toEqual(expected);
          expect(findIndexOfNearestSmallerInNumArray(data2_, ts)).toEqual(expected);
        });
      });
    });
    describe('sample 3', () => {
      [
        [0, -1],
        [1, -1],
        [18, -1],
      ].forEach(([ts, expected]) => {
        test(`ts: ${ts}, result: ${expected}`, () => {
          expect(findIndexOfNearestSmallerInNumArrayLEFT([], ts)).toEqual(expected);
          expect(findIndexOfNearestSmallerInNumArrayBINARY([], ts)).toEqual(expected);
          expect(findIndexOfNearestSmallerInNumArrayRIGHT([], ts)).toEqual(expected);
          expect(findIndexOfNearestSmallerInNumArray([], ts)).toEqual(expected);
        });
      });
    });
  });
});
