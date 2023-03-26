import { DateTime } from 'luxon';
import { DEFAULTS, IStreamConfig, TDbRecord, TEventRecord } from '../../src';

export const streamConfig: IStreamConfig = {
  streamId: 'test-stream',
  src: {
    schema: 'dbo',
    table: 'test',
    idFields: ['tradeno', 'seccode', 'buysell'],
    tsField: 'tradetime',
    timezoneOfTsField: 'GMT',
    dbOptions: {},
    dbConfig: {
      dialect: 'pg',
      host: 'localhost',
      port: 4444,
      user: 'user',
      password: '***',
      database: 'myDb',
    },
  },
  fields: {
    tradeno: 'long',
    tradetime: 'long',
    orderno: 'long',
    shortname: 'string',
    seccode: 'string',
    buysell: 'string',
  },
  fetchIntervalSec: 10,
  bufferMultiplier: 2,
  maxBufferSize: 65000,
  prepareEvent: function prepareEvent (dbRecord: TDbRecord): TEventRecord {
    const eventRecord = { ...dbRecord };
    eventRecord.tradetime = DateTime.fromISO(dbRecord.tradetime, { zone: 'GMT' }).toMillis();
    eventRecord.tradeno = Number(dbRecord.tradeno);
    eventRecord.orderno = Number(dbRecord.orderno);
    return eventRecord;
  },
  skipGaps: false,
  streamSendIntervalMillis: DEFAULTS.STREAM_SEND_INTERVAL_MILLIS,
  maxRunUpFirstTsVtMillis: DEFAULTS.MAX_RUNUP_FIRST_TS_VT_MILLIS,
};
