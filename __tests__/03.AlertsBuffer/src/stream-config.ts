import { IStreamConfig, TDbRecord, TEventRecord } from '../../../src';
import { millisToISO } from '../../lib/test-utils';

const dbConfig = require('../../lib/local.db.config.json');

export const streamConfig: IStreamConfig = {
  streamId: 'test-stream',
  src: {
    schema: 'test',
    table: 'test',
    idFields: ['ts', 'guid'],
    tsField: 'ts',
    timezoneOfTsField: 'GMT',
    dbOptions: {},
    dbConfig: {
      dialect: 'pg',
      host: 'localhost',
      port: 5432,
      user: 'user',
      password: '***',
      database: 'af-streams-test',
      ...dbConfig,
    },
  },
  fields: ['ts', 'guid', 'threshold', 'can_save_to_db', 'value', 'saved_to_db', 'sent_to_email'],
  fetchIntervalSec: 0.5,
  bufferMultiplier: 2,
  maxBufferSize: 65000,
  prepareEvent: function prepareEvent (dbRecord: TDbRecord): TEventRecord {
    const eventRecord = { ...dbRecord };
    eventRecord.tsISO = millisToISO(+eventRecord.ts);
    return eventRecord;
  },
  skipGaps: false,
  streamSendIntervalMillis: 5,
  maxRunUpFirstTsVtMillis: 100,
};
