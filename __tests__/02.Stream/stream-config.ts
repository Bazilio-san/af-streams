import { DateTime } from 'luxon';
import { IStreamConfig, TDbRecord, TEventRecord, IStreamsParamsConfig } from '../../src';

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
  prepareEvent: function prepareEvent (dbRecord: TDbRecord): TEventRecord {
    const eventRecord = { ...dbRecord };
    eventRecord.tradetime = DateTime.fromISO(dbRecord.tradetime, { zone: 'GMT' }).toMillis();
    eventRecord.tradeno = Number(dbRecord.tradeno);
    eventRecord.orderno = Number(dbRecord.orderno);
    return eventRecord;
  },
};

export const streamsParamsConfig: IStreamsParamsConfig = {
  streamFetchIntervalSec: 10,
  streamBufferMultiplier: 2,
  streamMaxBufferSize: 65000,
  skipGaps: false,
  streamSendIntervalMillis: 10,
};
