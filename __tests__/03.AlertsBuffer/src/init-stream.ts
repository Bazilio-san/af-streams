/* eslint-disable import/newline-after-import */
import * as dotenv from 'dotenv';

dotenv.config();

import { echo, exitOnError, logger } from '../../lib/logger';
import eventEmitter from '../../lib/ee';
import {
  ICommonConfig,
  StreamsManager, Stream, IStartTimeConfig, ISenderConfig,
} from '../../../src';
import { streamConfig } from './stream-config';
import { checkAlertExists, mergeAlerts, mergeAlertsActions } from '../../lib/db-alerts';
import { TestAlgo } from './TestAlgo';

const emailConfig = require('../../lib/local.email.config.json');

const commonConfig: ICommonConfig = {
  serviceName: 'test',
  logger,
  echo,
  exitOnError,
  eventEmitter,
  skipInitDbConnection: false,
};

export const streamsManager = new StreamsManager(commonConfig);

export const initStreams = async (): Promise<Stream[]> => {
  process.env.STREAM_START_TIME = '2023-01-01T23:59:55';
  process.env.STREAM_SPEED = '1';

  const startTimeConfig: IStartTimeConfig = {
    redis: { host: process.env.REDIS_HOST || 'localhost' },
    useStartTimeFromRedisCache: false,
  };
  // Инициализация объекта VirtualTimeObj
  const virtualTimeObj = await streamsManager.prepareVirtualTimeObj({ virtualTimeConfig: {}, startTimeConfig });
  const alertsBuffer = streamsManager.prepareAlertsBuffer({
    emailSettings: { ...emailConfig, throttleAlertsIntervalSeconds: 5 },
    checkAlertExists,
    mergeAlerts,
    setFlagToProcForOperators: [3],
    mergeAlertsActions,
    // Время слежения за признаками отправки и сохранения сигнала
    trackAlertsStateMillis: 4_000,
    flushBufferIntervalSeconds: 1,
  });
  const testAlgo = new TestAlgo({ alertsBuffer, eventName: 'TEST_ALERT_EVENT_NAME' });
  const senderConfig: ISenderConfig = {
    type: 'callback',
    eventCallback: testAlgo.onEvent.bind(testAlgo),
  };
  // Инициализация потока
  const streams = await streamsManager.prepareStreams([{ streamConfig, senderConfig }]);
  try {
    await streamsManager.initStreams();
    virtualTimeObj.unLock();
  } catch (err) {
    exitOnError(err);
  }
  return streams;
};
