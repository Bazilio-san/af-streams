/* eslint-disable no-console */
// noinspection JSUnusedGlobalSymbols

import { createClient, RedisClientType, RedisDefaultModules, RedisModules, RedisScripts } from 'redis';
import { DateTime } from 'luxon';
import { RedisFunctions } from '@redis/client';
import { boolEnv, getStreamKey, getTimeParamMillis, intEnv, strEnv, timeParamRE } from './utils/utils';
import { ICommonConfig, IStartTimeConfig } from './interfaces';
import { millis2iso } from './utils/date-utils';

const prefix = '[af-streams:redis]: ';

export interface StartTimeRedisConstructorOptions {
  commonConfig: ICommonConfig,
  startTimeConfig: IStartTimeConfig
}

export class StartTimeRedis {
  private readonly client: RedisClientType<RedisDefaultModules & RedisModules, RedisFunctions, RedisScripts>;

  private readonly streamKey: string;

  private readonly url: string;

  private onSaveLastTsCallBack: OmitThisParameter<({ lastTs }: { serviceName: string; lastTs: number }) => Promise<void>>;

  constructor (public options: StartTimeRedisConstructorOptions) {
    const { commonConfig, startTimeConfig } = options;
    const { redis = { port: 0, host: '' } } = startTimeConfig;
    const { logger, exitOnError, serviceName } = commonConfig;
    redis.port = redis.port || intEnv('STREAM_REDIS_PORT', 6379);
    redis.host = redis.host || strEnv('STREAM_REDIS_HOST', '');
    if (!redis?.host) {
      exitOnError(`Не указан redis.host при инициализации потока потоков для сервиса ${serviceName}`);
    }
    startTimeConfig.useStartTimeFromRedisCache = startTimeConfig.useStartTimeFromRedisCache == null
      ? boolEnv('STREAM_USE_START_TIME_FROM_REDIS_CACHE', true)
      : Boolean(startTimeConfig.useStartTimeFromRedisCache);

    this.url = `redis://${redis.host}:${redis.port}`;
    this.streamKey = getStreamKey(serviceName);
    logger.info(`${prefix}Redis expected at ${this.url}`);
    this.client = createClient({ url: this.url });
    this.client.on('error', (err: Error | any) => {
      console.error('Redis Client Error');
      exitOnError(err);
    });

    this.onSaveLastTsCallBack = this.onSaveLastTs.bind(this);
    commonConfig.eventEmitter.on('save-last-ts', this.onSaveLastTsCallBack);
  }

  async onSaveLastTs ({ lastTs }: { serviceName: string, lastTs: number }) {
    const redisClient = await this.getRedisClient();
    redisClient?.set(this.streamKey, lastTs).catch((err: Error | any) => {
      this.options.commonConfig.logger.error(err);
    });
  }

  async getRedisClient (): Promise<RedisClientType<RedisDefaultModules, RedisFunctions & RedisModules, RedisScripts>> {
    if (this.client.isOpen) {
      return this.client;
    }
    const { logger, exitOnError } = this.options.commonConfig;
    try {
      await this.client.connect();
      logger.info(`${prefix}Connected to REDIS on URL: ${this.url} / streamKey: ${this.streamKey}`);
    } catch (err: Error | any) {
      logger.error('Failed to initialize Redis client');
      exitOnError(err);
    }
    if (!this.client.isOpen) {
      exitOnError('Failed to initialize Redis client');
    }
    return this.client;
  }

  async getStartTimeFromRedis (): Promise<number> {
    const { logger } = this.options.commonConfig;
    const redisClient = await this.getRedisClient();
    let startTimeMillis: number;
    try {
      startTimeMillis = Number(await redisClient.get(this.streamKey)) || 0;
    } catch (err) {
      logger.error(err);
      return 0;
    }
    if (!startTimeMillis) {
      return 0;
    }
    if (!DateTime.fromMillis(startTimeMillis).isValid) {
      logger.error(`Cache stored data is not a unix timestamp: ${startTimeMillis}`);
      return 0;
    }
    logger.info(`${prefix}Get time of last sent entry: ${millis2iso(startTimeMillis, { includeOffset: true })
    } from the Redis cache using key ${this.streamKey}`);
    return startTimeMillis;
  }

  // !!!Attention!!! STREAM_START_TIME - time in GMT
  getStartTimeFromENV (): number {
    const { logger } = this.options.commonConfig;
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

  async getStartTime (): Promise<{ isUsedSavedStartTime: boolean, startTimeMillis: number }> {
    // initialize connection with Redis to save state later
    await this.getRedisClient();
    let startTimeMillis = 0;
    let isUsedSavedStartTime = false;
    if (this.options.startTimeConfig.useStartTimeFromRedisCache) {
      startTimeMillis = await this.getStartTimeFromRedis();
      isUsedSavedStartTime = !!startTimeMillis;
    }
    startTimeMillis = startTimeMillis || this.getStartTimeFromENV() || Date.now();
    return { isUsedSavedStartTime, startTimeMillis };
  }

  destroy () {
    const { commonConfig } = this.options;
    commonConfig.eventEmitter.removeListener('save-last-ts', this.onSaveLastTsCallBack);
    this.client.disconnect().then(() => 0);
  }
}

let startTimeRedis: StartTimeRedis;

export const getStartTimeRedis = (options: StartTimeRedisConstructorOptions): StartTimeRedis => {
  if (!startTimeRedis) {
    startTimeRedis = new StartTimeRedis(options);
  }
  return startTimeRedis;
};
