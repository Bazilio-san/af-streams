const U = require('../../dist/utils');

const data = require('./data.json');

const data2 = [
  { ts: 10 },
];

const data3 = [];

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
        const result = U.findSmallestIndex(data, ts, 'ts');
        expect(result).toEqual(expected);
        const resultB = U.findSmallestIndexBinary(data, ts, 'ts');
        expect(resultB).toEqual(expected);
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
        const result = U.findSmallestIndex(data2, ts, 'ts');
        expect(result).toEqual(expected);
        const resultB = U.findSmallestIndexBinary(data2, ts, 'ts');
        expect(resultB).toEqual(expected);
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
        const result = U.findSmallestIndex(data3, ts, 'ts');
        expect(result).toEqual(expected);
        const resultB = U.findSmallestIndexBinary(data3, ts, 'ts');
        expect(resultB).toEqual(expected);
      });
    });
  });
});
