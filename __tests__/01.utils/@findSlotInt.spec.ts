import { findSlotIntData } from './find-slot-int.data';
import { TSlot } from '../../src';
import { findSlotInt, findSlotIntBINARY, findSlotIntLEFT, findSlotIntRIGHT } from '../../src/utils/find-slot-int';
import { findSlotFloatData, SIGMA } from './find-slot-float.data';
import {
  findSlotFloat,
  findSlotFloatBINARY,
  findSlotFloatLEFT,
  findSlotFloatRIGHT,
} from '../../src/utils/find-slot-float';

describe('findSlot **', () => {
  describe('findSlotInt *', () => {
    describe('findSlotIntLEFT', () => {
      findSlotIntData.forEach(([arr, num, expected], index) => {
        const result: TSlot = findSlotIntLEFT(arr as number[], num as number);
        test(`test ${index} (${num})`, () => {
          expect(result).toEqual(expected);
        });
      });
    });
    describe('findSlotIntRIGHT', () => {
      findSlotIntData.forEach(([arr, num, expected], index) => {
        const result: TSlot = findSlotIntRIGHT(arr as number[], num as number);
        test(`test ${index} (${num})`, () => {
          expect(result).toEqual(expected);
        });
      });
    });
    describe('findSlotIntBINARY', () => {
      findSlotIntData.forEach(([arr, num, expected], index) => {
        const result: TSlot = findSlotIntBINARY(arr as number[], num as number);
        test(`test ${index} (${num}) :: ${arr}`, () => {
          expect(result).toEqual(expected);
        });
      });
    });
    describe('findSlotInt', () => {
      findSlotIntData.forEach(([arr, num, expected], index) => {
        const result: TSlot = findSlotInt(arr as number[], num as number);
        test(`test ${index} (${num}) :: ${arr}`, () => {
          expect(result).toEqual(expected);
        });
      });
    });
  });

  describe('findSlotFloat', () => {
    describe('findSlotFloatLEFT', () => {
      findSlotFloatData.forEach(([arr, num, expected], index) => {
        const result: TSlot = findSlotFloatLEFT(arr as number[], num as number, SIGMA);
        test(`test ${index} (${num}) :: ${arr}`, () => {
          expect(result).toEqual(expected);
        });
      });
    });
    describe('findSlotFloatRIGHT', () => {
      findSlotFloatData.forEach(([arr, num, expected], index) => {
        const result: TSlot = findSlotFloatRIGHT(arr as number[], num as number, SIGMA);
        test(`test ${index} (${num}) :: ${arr}`, () => {
          expect(result).toEqual(expected);
        });
      });
    });
    describe('findSlotFloatBINARY', () => {
      findSlotFloatData.forEach(([arr, num, expected], index) => {
        const result: TSlot = findSlotFloatBINARY(arr as number[], num as number, SIGMA);
        test(`test ${index} (${num}) :: ${arr}`, () => {
          expect(result).toEqual(expected);
        });
      });
    });
    describe('findSlotFloat', () => {
      findSlotFloatData.forEach(([arr, num, expected], index) => {
        const result: TSlot = findSlotFloat(arr as number[], num as number, SIGMA);
        test(`test ${index} (${num}) :: ${arr}`, () => {
          expect(result).toEqual(expected);
        });
      });
    });
  });
});
