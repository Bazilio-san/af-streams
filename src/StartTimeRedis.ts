/* eslint-disable no-console */
// noinspection JSUnusedGlobalSymbols

import EventEmitter from 'events';
import { createClient, RedisClientType, RedisDefaultModules, RedisModules, RedisScripts } from 'redis';
import { DateTime } from 'luxon';
import { RedisFunctions } from '@redis/client';
import { boolEnv, getBool, getStreamKey, getTimeParamMillis, intEnv, strEnv, timeParamRE } from './utils/utils';
import { ILoggerEx } from './interfaces';
import { millis2iso } from './utils/date-utils';
import { IStreamConstructorOptions } from './Stream';

export interface IStartTimeRedisOptions {
  useStartTimeFromRedisCache: boolean,
  host: string,
  port: string | number,
  streamId: string,
  eventEmitter: EventEmitter,
  exitOnError: Function,
  logger: ILoggerEx,
}

const prefix = '[af-streams:redis]: ';

export class StartTimeRedis {
  private readonly options: IStartTimeRedisOptions;

  private readonly client: RedisClientType<RedisDefaultModules & RedisModules, RedisFunctions, RedisScripts>;

  private readonly streamKey: string;

  private readonly url: string;

  constructor (options: IStartTimeRedisOptions) {
    this.options = options;
    const { logger } = this.options;
    this.url = `redis://${options.host}:${options.port}`;
    const streamKey = getStreamKey(options.streamId);
    this.streamKey = streamKey;
    logger.info(`${prefix}Redis expected at ${this.url}`);
    this.client = createClient({ url: this.url });
    this.client.on('error', (err: Error | any) => {
      console.error('Redis Client Error');
      options.exitOnError(err);
    });
    options.eventEmitter.on('save-last-ts', async ({ lastTs }: { streamId: string, lastTs: number }) => {
      const redisClient = await this.getRedisClient();
      redisClient?.set(streamKey, lastTs).catch((err: Error | any) => {
        logger.error(err);
      });
    });
  }

  async getRedisClient (): Promise<RedisClientType<RedisDefaultModules, RedisFunctions & RedisModules, RedisScripts>> {
    if (this.client.isOpen) {
      return this.client;
    }
    const { logger } = this.options;
    try {
      await this.client.connect();
      logger.info(`${prefix}Connected to REDIS on URL: ${this.url} / streamKey: ${this.streamKey}`);
    } catch (err: Error | any) {
      logger.error('Failed to initialize Redis client');
      this.options.exitOnError(err);
    }
    if (!this.client.isOpen) {
      this.options.exitOnError('Failed to initialize Redis client');
    }
    return this.client;
  }

  async getStartTimeFromRedis (): Promise<number> {
    const { logger } = this.options;
    const redisClient = await this.getRedisClient();
    let startTime;
    try {
      startTime = await redisClient.get(this.streamKey);
    } catch (err) {
      logger.error(err);
      return 0;
    }
    startTime = Number(startTime);
    if (!startTime) {
      return 0;
    }
    if (!DateTime.fromMillis(startTime).isValid) {
      logger.error(`Cache stored data is not a unix timestamp: ${startTime}`);
      return 0;
    }
    logger.info(`${prefix}Get time of last sent entry: ${millis2iso(startTime, { includeOffset: true })} from the Redis cache using key ${this.streamKey}`);
    return startTime;
  }

  // !!!Attention!!! STREAM_START_TIME - time in GMT
  getStartTimeFromENV (): number {
    const { logger } = this.options;
    const { STREAM_START_TIME = '', STREAM_START_BEFORE = '' } = process.env;
    const dt = DateTime.fromISO(STREAM_START_TIME, { zone: 'GMT' });
    if (STREAM_START_TIME) {
      if (dt.isValid) {
        return dt.toMillis();
      }
      logger.error(`Start time is incorrect. STREAM_START_TIME: ${STREAM_START_TIME}`);
    }
    if (STREAM_START_BEFORE) {
      if (timeParamRE.test(STREAM_START_BEFORE)) {
        return Date.now() - getTimeParamMillis(STREAM_START_BEFORE);
      }
      logger.error(`Start time is incorrect. STREAM_START_BEFORE: ${STREAM_START_BEFORE}`);
    }
    return 0;
  }

  async getStartTime (): Promise<{ isUsedSavedStartTime: boolean, startTime: number }> {
    // initialize connection with Redis to save state later
    await this.getRedisClient();
    let startTime = 0;
    let isUsedSavedStartTime = false;
    if (this.options.useStartTimeFromRedisCache) {
      startTime = await this.getStartTimeFromRedis();
      isUsedSavedStartTime = !!startTime;
    }
    startTime = startTime || this.getStartTimeFromENV() || Date.now();
    return { isUsedSavedStartTime, startTime };
  }
}

let startTimeRedis: StartTimeRedis;

export const getStartTimeRedis = (options: IStartTimeRedisOptions): StartTimeRedis => {
  if (!startTimeRedis) {
    startTimeRedis = new StartTimeRedis(options);
  }
  return startTimeRedis;
};

export const getStartTimeRedisByStreamConfig = (streamConstructorOptions: IStreamConstructorOptions): StartTimeRedis => {
  if (startTimeRedis) {
    return startTimeRedis;
  }
  const {
    eventEmitter,
    logger,
    streamConfig,
    useStartTimeFromRedisCache,
    exitOnError,
  } = streamConstructorOptions;

  const { streamId } = streamConfig;

  streamConstructorOptions.redis = streamConstructorOptions.redis || { host: '', port: 0 };
  const { redis } = streamConstructorOptions;
  redis.host = redis.host || strEnv('STREAM_REDIS_HOST', '');
  if (!redis.host) {
    exitOnError(`Не указан redis.host при инициализации потока ${streamId}`);
  }
  redis.port = redis.port || intEnv('STREAM_REDIS_PORT', 6379);

  const startTimeRedisOptions: IStartTimeRedisOptions = {
    useStartTimeFromRedisCache: useStartTimeFromRedisCache == null
      ? boolEnv('STREAM_USE_START_TIME_FROM_REDIS_CACHE', true)
      : getBool(useStartTimeFromRedisCache, true),
    host: redis.host,
    port: redis.port,
    streamId,
    eventEmitter,
    exitOnError,
    logger,
  };
  startTimeRedis = new StartTimeRedis(startTimeRedisOptions);
  return startTimeRedis;
};
