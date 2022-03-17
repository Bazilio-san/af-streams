import * as dotenv from 'dotenv';
import * as EventEmitter from 'events';
import { DateTime } from 'luxon';
import { IStreamConstructorOptions, Stream, TDbRecord, TEventRecord } from '../../src';
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
    },
    senderConfig: {
      type: 'console',
      // host: 'localhost',
      // port: 1,
      // accessPoint: null
      // callback?: Function,
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
    testMode: true,
  };
  const stream = new Stream(streamConstructorOptions);
  try {
    await stream.init();
  } catch (err) {
    exitOnError(err);
  }
  stream.virtualTimeObj.setReady();
  return stream;
}

export default initStream;
