import * as dotenv from 'dotenv';
import * as EventEmitter from 'events';
import { DateTime } from 'luxon';
import { IStreamConstructorOptions, Stream } from '../../src';
import { echo, exitOnError, logger } from '../lib/logger';
import { TDbRecord, TEventRecord } from '../../src/interfaces';

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
        dbOptions: { dialect: 'pg' },
        dbConfig: {
          dialect: 'pg',
          host: 'localhost',
          port: 4444,
          user: 'user',
          password: '***',
          database: 'myDb',
        },
      },
      fieldsTypes: {
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
    config: {
      timezone: 'GMT',
      redis: {
        host: 'msa-cepe01-ap02.office.finam.ru',
        port: 6379,
      },
      service: { fromService: 'test' },
    },
    logger,
    echo,
    exitOnError,
    eventEmitter,
    speed: 1,
    // loopTimeMillis: 0,
    prepareEvent: function prepareEvent (dbRecord: TDbRecord): TEventRecord {
      const eventRecord = { ...dbRecord };
      eventRecord.tradetime = DateTime.fromISO(dbRecord.tradetime).toMillis();
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
