/* eslint-disable import/newline-after-import */
import * as dotenv from 'dotenv';

dotenv.config();

import { echo, exitOnError, logger } from '../lib/logger';
import eventEmitter from '../lib/ee';
import {
  ICommonConfig, IStartTimeConfig,
  StreamsManager, Stream,
} from '../../src';
import { streamConfig } from './stream-config';

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
  const startTimeConfig: IStartTimeConfig = { redis: { host: process.env.REDIS_HOST || 'localhost' } };
  // Инициализация объекта VirtualTimeObj
  const virtualTimeObj = await streamsManager.prepareVirtualTimeObj({ virtualTimeConfig: {}, startTimeConfig });

  // Инициализация потока
  const streams = await streamsManager.prepareStreams({ streamConfig, senderConfig: { type: 'console' } });
  try {
    await streamsManager.initStreams();
    virtualTimeObj.unLock();
  } catch (err) {
    exitOnError(err);
  }
  return streams[0];
}

export default initStream;
