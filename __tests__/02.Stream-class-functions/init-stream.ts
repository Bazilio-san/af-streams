import * as dotenv from 'dotenv';
import * as EventEmitter from 'events';
import { DateTime } from 'luxon';
import { DEFAULTS, IStreamConstructorOptions, Stream, TDbRecord, TEventRecord } from '../../src';
import { echo, exitOnError, logger } from '../lib/logger';

const eventEmitter = new EventEmitter();

dotenv.config();

async function initStream (): Promise<Stream> {
  const streamConstructorOptions: IStreamConstructorOptions = {
    streamConfig: {
      streamId: 'test-stream',
      // fetchIntervalSec: 10,
      // bufferMultiplier: 30,
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
      // printInfoIntervalSec: 10,
      fetchIntervalSec: 10,
      bufferMultiplier: 2,
      maxBufferSize: 65000,
    },
    senderConfig: {
      type: 'console',
      // host: 'localhost',
      // port: 1,
      // accessPoint: null
      // eventCallback?: Function,
      emitSingleEvent: true,
      // emitId: 'test-emit',
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: 6379,
    },
    serviceName: 'test',
    logger,
    echo,
    exitOnError,
    eventEmitter,
    speed: 1,
    useStartTimeFromRedisCache: false,
    // loopTime: 5min,
    prepareEvent: function prepareEvent (dbRecord: TDbRecord): TEventRecord {
      const eventRecord = { ...dbRecord };
      eventRecord.tradetime = DateTime.fromISO(dbRecord.tradetime, { zone: 'GMT' }).toMillis();
      eventRecord.tradeno = Number(dbRecord.tradeno);
      eventRecord.orderno = Number(dbRecord.orderno);
      return eventRecord;
    },
    skipGaps: false,
    streamSendIntervalMillis: DEFAULTS.STREAM_SEND_INTERVAL_MILLIS,
    timeFrontUpdateIntervalMillis: DEFAULTS.TIME_FRONT_UPDATE_INTERVAL_MILLIS,
    maxRunUpFirstTsVtMillis: DEFAULTS.MAX_RUNUP_FIRST_TS_VT_MILLIS,
    testMode: true,
  };
  const stream = new Stream(streamConstructorOptions);
  try {
    await stream.init();
  } catch (err) {
    exitOnError(err);
  }
  stream.virtualTimeObj.unLock();
  return stream;
}

export default initStream;
