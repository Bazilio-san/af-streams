/* eslint-disable no-console */
import EventEmitter from 'events';
import { createClient, RedisClientType, RedisDefaultModules, RedisModules, RedisScripts } from 'redis';
import { DateTime } from 'luxon';
import { getStreamKey } from './utils/utils';
import { ILoggerEx } from './interfaces';

export interface IStartTimeRedisOptions {
  host: string,
  port: string | number,
  streamId: string,
  eventEmitter: EventEmitter,
  exitOnError: Function,
  logger: ILoggerEx,
}

export class StartTimeRedis {
  private readonly client: RedisClientType<RedisDefaultModules & RedisModules, RedisScripts>;

  private readonly exitOnError: Function;

  private logger: ILoggerEx;

  private readonly streamKey: string;

  constructor (options: IStartTimeRedisOptions) {
    const { host, port, streamId, eventEmitter, exitOnError, logger } = options;
    this.exitOnError = exitOnError;
    this.logger = logger;
    const url = `redis://${host}:${port}`;
    console.log(`==================== Redis are expected at ${url} ========================`);
    this.client = createClient({ url });
    this.client.on('error', (err: Error | any) => {
      console.error('Redis Client Error');
      exitOnError(err);
    });
    const streamKey = getStreamKey(streamId);
    this.streamKey = streamKey;
    eventEmitter.on('save-last-ts', async (ts: number) => {
      const redisClient = await this.getRedisClient();
      redisClient?.set(streamKey, ts).catch((err: Error | any) => {
        logger.error(err);
      });
    });
  }

  async getRedisClient (): Promise<RedisClientType<RedisDefaultModules & RedisModules, RedisScripts>> {
    if (this.client.isOpen) {
      return this.client;
    }
    try {
      await this.client.connect();
    } catch (err: Error | any) {
      this.logger.error('Failed to initialize Redis client');
      this.exitOnError(err);
    }
    if (!this.client.isOpen) {
      this.exitOnError('Failed to initialize Redis client');
    }
    return this.client;
  }

  async getStartTimeFromRedis (): Promise<number> {
    const redisClient = await this.getRedisClient();
    let startTime;
    try {
      startTime = await redisClient.get(this.streamKey);
    } catch (err) {
      this.logger.error(err);
      return 0;
    }
    if (!startTime) {
      return 0;
    }
    startTime = Number(startTime);
    if (!startTime || !DateTime.fromMillis(startTime).isValid) {
      this.logger.error(`Cache stored data is not a unix timestamp: ${startTime}`);
      return 0;
    }
    this.logger.info(`Get time of last sent entry: ${DateTime.fromMillis(startTime).toISO()} from the Redis cache using key ${this.streamKey}`);
    return startTime;
  }
}
