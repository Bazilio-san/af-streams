import initStream from './init-stream';
import { Stream, STREAM_ID_FIELD, TS_FIELD } from '../../src';
import { Nullable, TEventRecord } from '../../src/interfaces';

let stream: Stream;

const convertToDbRecord = (item: Nullable<TEventRecord>) => {
  const {
    [STREAM_ID_FIELD]: sif, [TS_FIELD]: tsf, tradeno, tradetime, orderno, shortname, seccode, buysell,
  } = item || {};
  return {
    tradeno: String(tradeno),
    tradetime: (new Date(tradetime)).toISOString(),
    orderno: String(orderno),
    shortname,
    seccode,
    buysell,
    [TS_FIELD]: tsf,
    [STREAM_ID_FIELD]: sif,
  };
};

const removeSymbolTs = (item: Nullable<TEventRecord>) => {
  const item2 = { ...item };
  delete item2[TS_FIELD];
  delete item2[STREAM_ID_FIELD];
  return item2;
};

const removeSymbolTsArr = (arr: TEventRecord[]) => arr.map(removeSymbolTs);
const convertRecordsToExpected = (arr: TEventRecord[]) => arr.map(convertToDbRecord);

describe('Test CDC', () => {
  beforeAll(async () => {
    stream = await initStream();
  });

  describe('case1', () => {
    let portions: any[];
    let expected: any[];
    let ltr: any[];
    beforeAll(() => {
      portions = [
        require('./case1/0-data.json'),
        require('./case1/1-data.json'),
        require('./case1/2-data.json'),
      ];
      expected = [
        [],
        require('./case1/1-expected.json'),
        require('./case1/2-expected.json'),
      ];
      ltr = [
        require('./case1/0-data-ltr.json'),
        require('./case1/1-data-ltr.json'),
        require('./case1/2-data-ltr.json'),
      ];
    });
    test('test 1', async () => {
      const portions0clone = [...portions[0]];
      await stream._addPortionToBuffer(portions0clone);
      const [first, , , last] = portions[0];

      expect(stream.lastRecordTs).toEqual(+(new Date(last.tradetime)));

      const lastTimeRecords = stream.lastTimeRecords.getLtr();
      expect(lastTimeRecords).toMatchObject(ltr[0]);

      expect(convertToDbRecord(stream.recordsBuffer.first)).toEqual(first);
      expect(convertToDbRecord(stream.recordsBuffer.last)).toEqual(last);

      const resBuffer = convertRecordsToExpected(stream.recordsBuffer.buffer);
      expect(resBuffer).toEqual(portions[0]);
    });

    test('test 2', async () => {
      const portions1clone = [...portions[1]];
      await stream._addPortionToBuffer(portions1clone);
      const last = portions[1][6];

      expect(stream.lastRecordTs).toEqual(+(new Date(last.tradetime)));

      const lastTimeRecords = stream.lastTimeRecords.getLtr();
      expect(lastTimeRecords).toEqual(ltr[1]);

      expect(convertToDbRecord(stream.recordsBuffer.first)).toEqual(portions[0][0]);
      expect(convertToDbRecord(stream.recordsBuffer.last)).toEqual(last);

      const resBuffer = convertRecordsToExpected(stream.recordsBuffer.buffer);
      expect(removeSymbolTsArr(resBuffer)).toEqual(expected[1]);
    });

    test('test 3', async () => {
      const portions2clone = [...portions[2]];
      await stream._addPortionToBuffer(portions2clone);
      const last = portions[2][4];

      expect(stream.lastRecordTs).toEqual(+(new Date(last.tradetime)));

      const lastTimeRecords = stream.lastTimeRecords.getLtr();
      expect(lastTimeRecords).toEqual(ltr[2]);

      expect(convertToDbRecord(stream.recordsBuffer.first)).toEqual(portions[0][0]);
      expect(convertToDbRecord(stream.recordsBuffer.last)).toEqual(last);

      const resBuffer = convertRecordsToExpected(stream.recordsBuffer.buffer);
      expect(removeSymbolTsArr(resBuffer)).toEqual(expected[2]);
    });
  });

  describe('case2', () => {
    test('test 1', async () => {
      const portions = [
        require('./case2/0-data.json'),
        require('./case2/1-data.json'),
        require('./case2/2-data.json'),
      ];
      const expected = require('./case2/2-expected.json');
      stream.recordsBuffer.flush();
      await stream._addPortionToBuffer(portions[0]);
      await stream._addPortionToBuffer(portions[1]);
      await stream._addPortionToBuffer(portions[2]);
      const resBuffer = convertRecordsToExpected(stream.recordsBuffer.buffer);
      expect(removeSymbolTsArr(resBuffer)).toEqual(expected);
    });
  });

  describe('case3', () => {
    let portions: any[];
    let expected: any[];
    let ltr: any[];
    let resBuffer;
    beforeAll(() => {
      portions = [
        require('./case3/0-data.json'),
        require('./case3/1-data.json'),
        require('./case3/2-data.json'),
        require('./case3/3-data.json'),
      ];
      expected = [
        portions[0],
        portions[0],
        require('./case3/2-expected.json'),
        require('./case3/3-expected.json'),
      ];
      ltr = [
        require('./case3/0-data-ltr.json'),
        require('./case3/1-data-ltr.json'),
        require('./case3/2-data-ltr.json'),
        require('./case3/3-data-ltr.json'),
      ];
      stream.recordsBuffer.flush();
    });

    test('test 0', async () => {
      const portionsClone = [...portions[0]];
      await stream._addPortionToBuffer(portionsClone);
      expect(stream.lastTimeRecords.getLtr()).toEqual(ltr[0]);

      resBuffer = convertRecordsToExpected(stream.recordsBuffer.buffer);
      expect(resBuffer).toEqual(expected[0]);
    });

    test('test 1', async () => {
      const portionsClone = [...portions[1]];
      await stream._addPortionToBuffer(portionsClone);
      expect(stream.lastTimeRecords.getLtr()).toEqual(ltr[1]);

      resBuffer = convertRecordsToExpected(stream.recordsBuffer.buffer);
      expect(resBuffer).toEqual(expected[1]);
    });

    test('test 2', async () => {
      const portionsClone = [...portions[2]];
      await stream._addPortionToBuffer(portionsClone);
      expect(stream.lastTimeRecords.getLtr()).toEqual(ltr[2]);

      resBuffer = convertRecordsToExpected(stream.recordsBuffer.buffer);
      expect(removeSymbolTsArr(resBuffer)).toEqual(expected[2]);
    });

    test('test 3', async () => {
      const portionsClone = [...portions[3]];
      await stream._addPortionToBuffer(portionsClone);
      expect(stream.lastTimeRecords.getLtr()).toEqual(ltr[3]);

      resBuffer = convertRecordsToExpected(stream.recordsBuffer.buffer);
      expect(removeSymbolTsArr(resBuffer)).toEqual(expected[3]);
    });
  });
});
