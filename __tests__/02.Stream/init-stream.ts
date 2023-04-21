/* eslint-disable import/newline-after-import */
import * as dotenv from 'dotenv';

dotenv.config();

import { echo, exitOnError, logger } from '../lib/logger';
import eventEmitter from '../lib/ee';
import { ICommonConfig, IRedisConfig, StreamsManager, Stream, applyParamsConfigOnce } from '../../src';
import { streamConfig, paramsConfig } from './stream-config';

const commonConfig: ICommonConfig = {
  serviceName: 'test',
  logger,
  echo,
  exitOnError,
  eventEmitter,
  skipInitDbConnection: true,
};
export const streamsManager = new StreamsManager(commonConfig);

export const initStream = async (): Promise<Stream> => {
  // Инициализация параметров (происходит только один раз)
  applyParamsConfigOnce(paramsConfig);

  // Инициализация объекта VirtualTimeObj
  const redisConfig: IRedisConfig = { host: process.env.REDIS_HOST || 'localhost' };
  const virtualTimeObj = await streamsManager.prepareVirtualTimeObj(redisConfig);

  // Инициализация потока
  const streams = await streamsManager.prepareStreams({ streamConfig, senderConfig: { type: 'console' } });
  try {
    await streamsManager.initStreams();
    virtualTimeObj.unLock();
  } catch (err) {
    exitOnError(err);
  }
  return streams[0];
};
