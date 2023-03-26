/* eslint-disable import/newline-after-import */
import { DateTime } from 'luxon';
import * as dotenv from 'dotenv';

dotenv.config();

import { echo, exitOnError, logger } from '../lib/logger';
import eventEmitter from '../lib/ee';
import {
  DEFAULTS,
  ICommonConfig, ISenderConfig, IStreamConfig, IStartTimeConfig, IVirtualTimeConfig,
  TDbRecord, TEventRecord,
  StreamsManager, Stream,
} from '../../src';

const commonConfig: ICommonConfig = {
  serviceName: 'test',
  logger,
  echo,
  exitOnError,
  eventEmitter,
  testMode: true,
};
export const streamsManager = new StreamsManager(commonConfig);

async function initStream (): Promise<Stream> {
  // Параметры для подготовки объекта VirtualTimeObj
  const virtualTimeConfig: IVirtualTimeConfig = {
    speed: 1,
    timeFrontUpdateIntervalMillis: DEFAULTS.TIME_FRONT_UPDATE_INTERVAL_MILLIS,
  };
  const startTimeConfig: IStartTimeConfig = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: 6379,
    },
    useStartTimeFromRedisCache: false,
  };
  // Инициализация объекта VirtualTimeObj
  const virtualTimeObj = await streamsManager.prepareVirtualTimeObj({ virtualTimeConfig, startTimeConfig });

  // Параметры для подготовки потока
  const streamConfig: IStreamConfig = {
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
    // printInfoIntervalSec: 10,
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
  const senderConfig: ISenderConfig = {
    type: 'console',
    // host: 'localhost',
    // port: 1,
    // accessPoint: null
    // eventCallback?: Function,
    emitSingleEvent: true,
    // emitId: 'test-emit',
  };
  // Инициализация потока
  const streams = await streamsManager.prepareStreams({ streamConfig, senderConfig });
  const stream = streams[0];
  try {
    await stream.init();
  } catch (err) {
    exitOnError(err);
  }
  virtualTimeObj.unLock();
  // await streamsManager.start();
  return stream;
}

export default initStream;
