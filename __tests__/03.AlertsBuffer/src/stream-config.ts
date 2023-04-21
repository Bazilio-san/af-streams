import { DateTime } from 'luxon';
import { millisTo } from 'af-tools-ts';
import { EMailSendRule, IParamsConfig, IStreamConfig, TDbRecord, TEventRecord } from '../../../src';
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
  prepareEvent: function prepareEvent (dbRecord: TDbRecord): TEventRecord {
    const eventRecord = { ...dbRecord };
    eventRecord.ts = +eventRecord.ts;
    eventRecord.tsISO = millisToISO(eventRecord.ts);
    return eventRecord;
  },
  millis2dbFn: (millis: number) => millisTo.db.pgUtc(millis),
  tsFieldToMillis: (dt: Date) => {
    const a = Number(dt);
    const b = DateTime.fromJSDate(dt).toMillis();
    if (a !== b) {
      return a;
    }
    return b;
  },
};
export const paramsConfig: IParamsConfig = {
  emailOneTimeSendLimit: 20,
  emailSendRule: EMailSendRule.IF_ALERT_NOT_EXISTS,
  flushAlertsBufferIntervalSec: 1,
  loopTimeMillis: 0,
  maxRunUpFirstTsVtMillis: 100,
  printInfoIntervalSec: 60,
  processHistoricalAlerts: false,
  rectifierAccumulationTimeMillis: 60_000,
  rectifierSendIntervalMillis: 10,
  skipGaps: false,
  speed: 1,
  streamBufferMultiplier: 2,
  streamFetchIntervalSec: 1,
  streamMaxBufferSize: 65000,
  streamSendIntervalMillis: 5,
  timeFrontUpdateIntervalMillis: 5,
  timeStartBeforeMillis: 0,
  timeStartMillis: DateTime.fromISO('2023-01-01T23:59:55Z').toMillis(),
  timeStartTakeFromRedis: false,
  timeStopMillis: 0,
};
