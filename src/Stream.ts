import EventEmitter from 'events';
import { DateTime } from 'luxon';
import * as cron from 'cron';
import { Promise } from 'mssql';
import { LastTimeRecords } from './LastTimeRecords';
import { RecordsBuffer } from './RecordsBuffer';
import { getStartTimeRedis, IStartTimeRedisOptions } from './StartTimeRedis';
import { getVirtualTimeObj, IVirtualTimeObjOptions, VirtualTimeObj } from './VirtualTimeObj';
import {
  boolEnv, cloneDeep, getBool, getTimeParamMillis, intEnv, memUsage, padL, strEnv,
} from './utils/utils';
import getDb from './db/db';
import {
  blue, bold, boldOff, c, g, lBlue, lc, lCyan, lm, m, rs, y, bg, yellow,
} from './utils/color';
import {
  IDbConstructorOptions,
  IEcho, IEmAfterLoadNextPortion, IEmBeforeLoadNextPortion,
  IEmCurrentLastTimeRecords, IEmFindNextTs, IEmSaveLastTs,
  IEmSubtractedLastTimeRecords,
  ILoggerEx,
  IRecordsComposite,
  ISender,
  ISenderConfig,
  ISenderConstructorOptions,
  IStreamConfig, IStreamStat,
  TDbRecord,
  TEventRecord,
} from './interfaces';
import { DbMsSql } from './db/DbMsSql';
import { DbPostgres } from './db/DbPostgres';
import getSender from './sender/get-sender';
import { DEBUG_LNP, DEBUG_LTR, DEBUG_STREAM, DEFAULTS, STREAM_ID_FIELD, TS_FIELD } from './constants';
import { millis2iso, millis2isoZ } from './utils/date-utils';
import localEventEmitter from './ee-scoped';

export interface IStreamConstructorOptions {
  streamConfig: IStreamConfig,
  senderConfig: ISenderConfig,
  serviceName?: string,
  redis?: {
    host: string,
    port?: string | number
  },
  logger: ILoggerEx,
  echo: IEcho,
  exitOnError: Function,
  eventEmitter: EventEmitter,

  useStartTimeFromRedisCache?: boolean,
  speed?: number,
  loopTime?: string | number,
  prepareEvent?: Function,
  tsFieldToMillis?: Function,
  millis2dbFn?: Function,
  skipGaps?: boolean, // skip gaps in data when working in virtual time mode
  /**
   * The interval for sending data from the buffer
   */
  streamSendIntervalMillis?: number, // default 10 ms
  speedCalcIntervalSec?: number, // default 10 s
  timeFrontUpdateIntervalMillis?: number, // default 5 ms
  maxRunUpFirstTsVtMillis?: number, // Не допускаем увеличение разницы между ts первого элемента и виртуальным временем боле, чем на это значение
  timeDelayMillis?: number, // Искусственное отставание при выборке данных
  testMode?: boolean,
}

const getInitStat = () => ({ queryTs: 0 });

export class Stream {
  /**
   * Timestamp of the last loaded record
   */
  public lastRecordTs: number;

  /**
   * Left border for next request
   */
  public nextStartTs: number;

  public recordsBuffer: RecordsBuffer;

  public lastTimeRecords: LastTimeRecords;

  public virtualTimeObj: VirtualTimeObj;

  public sender: ISender;

  public readonly sessionId: string = `sid${+(new Date())}`;

  public db: DbMsSql | DbPostgres;

  public locked: boolean = false;

  private loopTimeMillis: number = 0;

  private busy: number;

  private _sendTimer: any;

  private _printTimer: any;

  /**
   * The interval for sending data from the buffer multiplied by the speed of virtual time
   */
  public sendIntervalVirtualMillis: number = 10;

  public totalRowsSent: number;

  private readonly tsFieldToMillis: Function;

  private readonly prepareEvent: Function;

  private readonly millis2dbFn: Function;

  private initialized: boolean = false;

  private isFirstLoad: boolean = true;

  //-----------------------------------------
  private prevLastRecordTs: number;

  private noRecordsQueryCounter: number;
  //-----------------------------------------

  public prefix: string;

  public stat: IStreamStat = getInitStat();

  private isPrepareEventAsync: boolean;

  constructor (public options: IStreamConstructorOptions) {
    const { streamConfig, prepareEvent, tsFieldToMillis, millis2dbFn } = options;
    const { src } = streamConfig;
    src.timezoneOfTsField = src.timezoneOfTsField || 'GMT';
    const zone = src.timezoneOfTsField;

    const tsFieldToMillisDefault = (tsValue: string | Date | number) => {
      if (typeof tsValue === 'string') {
        return DateTime.fromISO(tsValue, { zone }).toMillis();
      }
      return Number(tsValue);
    };

    this.tsFieldToMillis = typeof tsFieldToMillis === 'function'
      ? tsFieldToMillis.bind(this)
      : tsFieldToMillisDefault;

    this.prepareEvent = typeof prepareEvent === 'function'
      ? prepareEvent.bind(this)
      : (dbRecord: TDbRecord) => dbRecord;

    this.isPrepareEventAsync = this.prepareEvent.constructor.name === 'AsyncFunction';

    this.millis2dbFn = typeof millis2dbFn === 'function'
      ? millis2dbFn.bind(this)
      : (millis: number) => `'${millis2iso(millis)}'`;

    const { idFields } = src;

    this.sender = {} as ISender;
    this.db = {} as DbMsSql | DbPostgres;
    this.lastRecordTs = 0;
    this.nextStartTs = 0;

    // Properties for Jumping Data Breaks
    this.prevLastRecordTs = 0;
    this.noRecordsQueryCounter = 0;

    this.recordsBuffer = new RecordsBuffer();
    /*
     A set of hashes of string identification fields, along with a timestamp
     equal to the largest value in the last received packet.
     Serves to discard from the next portion of the data that has already been loaded.

     This is necessary if there can be several entries for one timestamp.
     EXAMPLE:
      tradeno    tradetime                    orderno  seccode                buysell  client
      38686190  2022-02-07 10:29:55.0000000  3420385   FSTOSS300901C00000010  B        MCU1100
      38686190  2022-02-07 10:29:55.0000000  3420375   FSTOSS300901C00000010  S        MCU57801

     In order to guarantee not to lose data, we request them with a timestamp overlap
          WHERE [${tsField}] >= '${from}' AND [${tsField}] <= '${to}'
     To ensure that duplicates are excluded, after receiving the data, we delete from there those that are in lastTimeRecords
     */
    this.lastTimeRecords = new LastTimeRecords(idFields);

    this.virtualTimeObj = {} as VirtualTimeObj;

    this._sendTimer = null;
    this.totalRowsSent = 0;
    this.busy = 0;

    options.eventEmitter?.on('virtual-time-loop-back', () => {
      this.lastRecordTs = 0;
      this.nextStartTs = this.virtualTimeObj.virtualStartTs;
      this.recordsBuffer.flush();
      this.lastTimeRecords.flush();
      this.totalRowsSent = 0;
      this.isFirstLoad = true;
    });

    options.eventEmitter?.on('virtual-time-is-synchronized-with-current', () => {
      this.resetSendIntervalVirtualMillis();
    });

    this.prefix = `${lCyan}STREAM: ${lBlue}${options.streamConfig.streamId}${rs}`;
  }

  // ####################################  SET  ################################

  setFetchIntervalSec (value?: number) {
    this.options.streamConfig.fetchIntervalSec = (value && Number(value))
      || Number(this.options.streamConfig.fetchIntervalSec)
      || intEnv('STREAM_FETCH_INTERVAL_SEC', DEFAULTS.FETCH_INTERVAL_SEC); // 10 sec
  }

  setSpeed (value?: number) {
    this.options.speed = (value && Number(value))
      || Number(this.options.speed)
      || intEnv('STREAM_SPEED', 1);
    this.resetSendIntervalVirtualMillis();
  }

  setBufferMultiplier (value?: number) {
    value = (value && Number(value))
      || Number(this.options.streamConfig.bufferMultiplier)
      || intEnv('STREAM_BUFFER_MULTIPLIER', DEFAULTS.BUFFER_MULTIPLIER); // Default 2
    this.options.streamConfig.bufferMultiplier = Math.max(value, 1);
  }

  setMaxBufferSize (value?: number) {
    this.options.streamConfig.maxBufferSize = (value && Number(value))
      || Number(this.options.streamConfig.maxBufferSize)
      || intEnv('STREAM_MAX_BUFFER_SIZE', DEFAULTS.MAX_BUFFER_SIZE); // Default 65_000;
  }

  setStreamSendIntervalMillis (value?: number) {
    this.options.streamSendIntervalMillis = (value && Number(value))
      || Number(this.options.streamSendIntervalMillis)
      || intEnv('STREAM_SEND_INTERVAL_MILLIS', DEFAULTS.STREAM_SEND_INTERVAL_MILLIS); // 10 ms ;
    this.resetSendIntervalVirtualMillis();
  }

  setMaxRunUpFirstTsVtMillis (value?: number) {
    this.options.maxRunUpFirstTsVtMillis = (value && Number(value))
      || Number(this.options.maxRunUpFirstTsVtMillis)
      || intEnv('STREAM_MAX_RUNUP_FIRST_TS_VT_MILLIS', DEFAULTS.MAX_RUNUP_FIRST_TS_VT_MILLIS); // 2_000 ms
  }

  setTimeDelay (value?: number) {
    value = (value && Number(value)) || Number(this.options.timeDelayMillis) || 0;
    this.options.timeDelayMillis = Math.max(0, value);
  }

  setSkipGaps (value?: number) {
    if (value != null) {
      this.options.skipGaps = getBool(value, DEFAULTS.SKIP_GAPS);
      return;
    }
    this.options.skipGaps = boolEnv('STREAM_SKIP_GAPS', DEFAULTS.SKIP_GAPS);
  }

  setLoopTime (value?: number) {
    this.loopTimeMillis = getTimeParamMillis(value != null ? value : strEnv('STREAM_LOOP_TIME', ''));
  }

  setPrintInfoIntervalSec (value?: number) {
    this.options.streamConfig.printInfoIntervalSec = (value && Number(value))
      || Number(this.options.streamConfig.printInfoIntervalSec)
      || intEnv('STREAM_PRINT_INFO_INTERVAL_SEC', DEFAULTS.PRINT_INFO_INTERVAL_SEC); // Default 60;
  }

  resetSendIntervalVirtualMillis () {
    const streamSendIntervalMillis = this.options.streamSendIntervalMillis || DEFAULTS.STREAM_SEND_INTERVAL_MILLIS;
    const speed = this.virtualTimeObj.isCurrentTime ? 1 : (this.options.speed || 1);
    this.sendIntervalVirtualMillis = streamSendIntervalMillis * speed;
  }

  // ###############################  INIT & START  ############################

  /**
   * Preparing entities for the flow to work
   * - determination of the given speed of the flow of virtual time
   * - determination of start time
   * - initializing the sender and checking the connection with the receiver
   * - initializing VirtualTimeObj (the object will be initialized in a locked state)
   * - connection to database source
   *
   * Output of start information
   */
  async init (): Promise<Stream | undefined> {
    this.setFetchIntervalSec();
    this.setSpeed();
    this.setBufferMultiplier();
    this.setMaxBufferSize();
    this.setStreamSendIntervalMillis();
    this.setMaxRunUpFirstTsVtMillis();
    this.setTimeDelay();
    this.setSkipGaps();
    this.setLoopTime();

    const { options: streamConstructorOptions, loopTimeMillis, millis2dbFn } = this;
    const {
      senderConfig,
      eventEmitter,
      echo,
      logger,
      serviceName,
      streamConfig,
      useStartTimeFromRedisCache,
      exitOnError,
      testMode,
      speedCalcIntervalSec,
      timeFrontUpdateIntervalMillis,
      speed,
    } = streamConstructorOptions;

    const senderConstructorOptions: ISenderConstructorOptions = {
      streamConfig,
      senderConfig,
      serviceName,
      echo,
      logger,
      exitOnError,
      eventEmitter,
    };
    this.sender = await getSender(senderConstructorOptions);

    const isConnectedToTarget = await this.sender.connect();
    if (!isConnectedToTarget) {
      exitOnError('No connection to sender');
      return;
    }

    const { src: { dbOptions, dbConfig, timezoneOfTsField }, streamId } = streamConfig;

    streamConstructorOptions.redis = streamConstructorOptions.redis || { host: '', port: 0 };
    const { redis } = streamConstructorOptions;
    redis.host = redis.host || strEnv('STREAM_REDIS_HOST', '');
    if (!redis.host) {
      exitOnError(`Не указан redis.host при инициализации потока ${streamId}`);
      return;
    }
    redis.port = redis.port || intEnv('STREAM_REDIS_PORT', 6379);

    const startTimeRedisOptions: IStartTimeRedisOptions = {
      useStartTimeFromRedisCache:
        useStartTimeFromRedisCache == null
          ? boolEnv('STREAM_USE_START_TIME_FROM_REDIS_CACHE', true)
          : getBool(useStartTimeFromRedisCache, true),
      host: redis.host,
      port: redis.port,
      streamId,
      eventEmitter,
      exitOnError,
      logger,
    };
    const startTimeRedis = getStartTimeRedis(startTimeRedisOptions);

    const { isUsedSavedStartTime, startTime } = await startTimeRedis.getStartTime();

    const virtualTimeObjOptions: IVirtualTimeObjOptions = {
      startTime,
      eventEmitter,
      speed,
      loopTimeMillis,
      echo,
      exitOnError,
      speedCalcIntervalSec,
      timeFrontUpdateIntervalMillis,
    };

    this.virtualTimeObj = getVirtualTimeObj(virtualTimeObjOptions);
    this.virtualTimeObj.registerStream(this);
    this.nextStartTs = this.virtualTimeObj.virtualStartTs;
    const msg = ` [af-streams: ${streamId}] `;
    const eq = '='.repeat(Math.max(1, Math.ceil((64 - msg.length) / 2)));
    const info = `${g}${eq}${msg}${eq}
${g}Time field TZ:         ${m}${timezoneOfTsField}
${g}Start from beginning:  ${m}${useStartTimeFromRedisCache ? 'NOT' : 'YES'}
${g}Start time:            ${m}${millis2isoZ(startTime)}${isUsedSavedStartTime ? `${y}${bold} TAKEN FROM CACHE${boldOff}${rs}${g}` : ''}
${g}Speed:                 ${m}${this.virtualTimeObj.options.speed} X
${g}Cyclicity:             ${m}${loopTimeMillis ? `${loopTimeMillis / 1000} sec` : '-'}
${g}Db polling frequency:  ${m}${streamConfig.fetchIntervalSec} sec
${g}================================================================`;
    echo(info);

    if (!testMode) {
      const dbConstructorOptions: IDbConstructorOptions = {
        streamConfig,
        logger,
        eventEmitter,
        exitOnError,
        dbOptions,
        dbConfig,
        millis2dbFn,
      };
      this.db = await getDb(dbConstructorOptions);
    }
    this.initialized = true;
    return this;
  }

  /**
   * Запуск
   */
  async start (): Promise<Stream> {
    this.isPrepareEventAsync = this.prepareEvent.constructor.name === 'AsyncFunction';
    if (!this.initialized) {
      await this.init();
    }
    await this._loadNextPortion();
    this._fetchLoop();
    this._printInfoLoop();
    // Additional external call loop in case of interruption of the chain of internal calls _sendLoop()
    this._sendTimer = setInterval(() => {
      this._sendLoop().then(() => null);
    }, 1000);
    return this;
  }

  // ##############################  PREPARE EVENTS  ###########################

  // Greatest index of a value less than the specified
  findEndIndex (vt: number) {
    /*
    if (DEBUG_STREAM) {
      const { buffer: rb } = this.recordsBuffer;
      const firstISO = rb.length ? millis2iso(rb[0][TS_FIELD]) : '-';
      const lastISO = rb.length > 1 ? millis2iso(rb[rb.length - 1][TS_FIELD]) : '-';
        this.options.echo(`findEndIndex() ${c}virtualTime: ${m}${millis2iso(virtualTime)}${rs} [${m}${firstISO}${rs} - ${m}${lastISO}${rs}]`);
    }
    */
    return this.recordsBuffer.findIndexOfNearestSmaller(vt);
  }

  static packetInfo (count: number, fromRecord?: TEventRecord | null, toRecord?: TEventRecord | null) {
    if (count && fromRecord && toRecord) {
      const HMS = 'HH:mm:ss.SSS';
      const from = fromRecord[TS_FIELD];
      const to = toRecord[TS_FIELD];
      const fromLu = DateTime.fromMillis(from);
      const timeRange = `${fromLu.toFormat('LL-dd')} ${fromLu.toFormat(HMS)} - ${DateTime.fromMillis(to).toFormat(HMS)}`;
      return `r: ${padL(count, 5)} / ${timeRange} / ${padL(`${to - from} ms`, 10)}`;
    }
    return ' '.repeat(60);
  }

  async prepareEventsPacket (dbRecordOrRecordset: (TDbRecord | null)[]): Promise<TEventRecord[]> {
    const TIMEOUT_TO_PREPARE_EVENT = 5 * 60_000; // VVQ
    const { options: { streamConfig: { streamId, src: { tsField } } }, prepareEvent, isPrepareEventAsync, tsFieldToMillis } = this;
    if (!Array.isArray(dbRecordOrRecordset)) {
      if (!dbRecordOrRecordset || typeof dbRecordOrRecordset !== 'object') {
        return [];
      }
      dbRecordOrRecordset = [dbRecordOrRecordset];
    }

    return Promise.all(dbRecordOrRecordset.map((record, index) => {
      if (!record) {
        return null;
      }
      dbRecordOrRecordset[index] = null;

      record[TS_FIELD] = tsFieldToMillis(record[tsField]);
      record[STREAM_ID_FIELD] = streamId;

      return new Promise((resolve: (arg0: TEventRecord | null) => void) => {
        const timerId = setTimeout(() => {
          resolve(null);
        }, TIMEOUT_TO_PREPARE_EVENT);
        if (isPrepareEventAsync) {
          prepareEvent(record).then((eventRecord: TEventRecord) => {
            resolve(eventRecord);
            clearTimeout(timerId);
          });
        } else {
          const eventRecord = prepareEvent(record);
          resolve(eventRecord);
          clearTimeout(timerId);
        }
      });
    }));
  }

  async _addPortionToBuffer (recordset: TDbRecord[]): Promise<void> {
    const { recordsBuffer, loopTimeMillis, options } = this;
    const { streamConfig: { streamId } } = options;
    const { length: loadedCount = 0 } = recordset;
    let skipped = 0;
    let toUseCount = loadedCount;

    if (loadedCount) {
      const forBuffer = await this.prepareEventsPacket(recordset);
      recordset.splice(0, recordset.length);

      if (loopTimeMillis) {
        const { loopNumber } = this.virtualTimeObj;
        const bias = loopNumber * loopTimeMillis;
        forBuffer.forEach((row) => {
          row._ts = row[TS_FIELD] + bias;
          row.loopNumber = loopNumber;
        });
      }

      this.lastRecordTs = forBuffer[forBuffer.length - 1][TS_FIELD];

      // Removing from the received package those records that were already received in the previous package
      const subtractedLastTimeRecords = this.lastTimeRecords.subtractLastTimeRecords(forBuffer);
      if (DEBUG_LTR) {
        const payload: IEmSubtractedLastTimeRecords = { streamId, subtractedLastTimeRecords };
        options.eventEmitter?.emit('subtracted-last-time-records', payload);
      }
      // Since the previous step may have removed previously received records,
      // the length of forBuffer may be less
      toUseCount = forBuffer.length;
      skipped = loadedCount - toUseCount;

      if (toUseCount) {
        recordsBuffer.add(forBuffer);
        // currentLastTimeRecords contains records from a batch with the same latest timestamp
        const currentLastTimeRecords = this.lastTimeRecords.fillLastTimeRecords(this.recordsBuffer.buffer);
        if (DEBUG_LTR) {
          const payload: IEmCurrentLastTimeRecords = { streamId, currentLastTimeRecords };
          options.eventEmitter?.emit('current-last-time-records', payload);
        }
      }
    }
    if (DEBUG_STREAM) {
      options.echo(`${this.prefix} vt: ${this.virtualTimeObj.virtualTimeString
      } loaded/skipped/used: ${lm}${loadedCount}${blue}/${lc}${skipped}${blue}/${g}${toUseCount}${rs}`);
    }
  }

  // #################################  LOAD  ##################################
  getBufferLookAhead () {
    const { fetchIntervalSec, bufferMultiplier } = this.options.streamConfig;
    // Запрос данных со сдвигом виртуального времени на bufferMultiplier интервалов опроса
    return (fetchIntervalSec || DEFAULTS.FETCH_INTERVAL_SEC) * 1000
      * Math.max(bufferMultiplier || DEFAULTS.BUFFER_MULTIPLIER, 1)
      * (this.virtualTimeObj.isCurrentTime ? 1 : this.options.speed || 1);
  }

  private async _loadNextPortion () {
    const { options, recordsBuffer, virtualTimeObj, stat } = this;
    let { nextStartTs } = this;
    const { streamConfig: { streamId, maxBufferSize }, timeDelayMillis = 0 } = options;

    const bufferLookAheadMs = this.getBufferLookAhead();

    let [isCurrentTime, virtualTs] = virtualTimeObj.setNextTimeFront();

    // Если расстояние по времени от первой до последней записи в буфере больше bufferLookAheadMs, новых записей подгружать не нужно
    if (((recordsBuffer.getMsDistance()) >= bufferLookAheadMs)) {
      return;
    }

    if (isCurrentTime) {
      // === Режим РЕАЛЬНОГО времени ===
      // Начальное время запроса не может быть позже текущего времени
      nextStartTs = Math.min(nextStartTs, virtualTs);
    } else if (nextStartTs - virtualTs >= bufferLookAheadMs) {
      // === Режим виртуального времени ===
      // Если время начала следующего запроса находится впереди текущего виртуального времени более,
      // чем на расстояние bufferLookAheadMs, новых записей подгружать не нужно
      return;
    }

    let startTs = nextStartTs;
    let endTs = virtualTimeObj.virtualTs + bufferLookAheadMs + (stat.queryTs * (isCurrentTime ? 1 : (options.speed || 1)));
    // С учетом предыдущих условий, тут расстояние между startTs и endTs не должно превышать

    if (this.isFirstLoad) {
      startTs = virtualTimeObj.virtualStartTs;
      endTs = startTs + bufferLookAheadMs;
      this.isFirstLoad = false;
    }

    if (startTs >= endTs) {
      return;
    }
    // Если расстояние по времени от первой до последней записи в буфере больше bufferLookAheadMs, новых записей подгружать не нужно
    if (((recordsBuffer.getMsDistance()) > bufferLookAheadMs)) {
      return;
    }
    const limit = (maxBufferSize || DEFAULTS.MAX_BUFFER_SIZE) - recordsBuffer.buffer.length;
    if (limit < 1) {
      return;
    }

    try {
      const payloadBefore: IEmBeforeLoadNextPortion = { streamId, startTs, endTs, vt: virtualTimeObj.virtualTs, timeDelayMillis };
      localEventEmitter.emit('before-lnp', payloadBefore);
      if (DEBUG_LNP) {
        options.eventEmitter?.emit('before-load-next-portion', payloadBefore);
      }
      const st = Date.now();
      // ================= get Portion Of Data =================
      const recordset: TDbRecord[] | null = await this.db.getPortionOfData({ startTs, endTs, limit, timeDelayMillis });
      // =======================================================
      stat.queryTs = Date.now() - st;

      const recordsetLength = recordset?.length || 0;
      await this._addPortionToBuffer(recordset); // Inside the function recordset is cleared

      const isLimitExceed = recordsetLength >= limit;

      ([isCurrentTime, virtualTs] = virtualTimeObj.setNextTimeFront());

      if (isLimitExceed && this.lastRecordTs) {
        // Если превышен лимит количества записей в одном запросе, то считаем,
        // что последняя запись не может быть старше реального времени,
        // И не параноим тут типа this.nextStartTs = Math.min(this.lastRecordTs, virtualTs) если isCurrentTime === true
        this.nextStartTs = this.lastRecordTs;
      } else {
        // В случае, если лимит не превышен, чтобы не впасть в цикл пустых выборок
        // в режиме РЕАЛЬНОГО времени, нужно не допустить убегания nextStartTs в будущее.
        this.nextStartTs = isCurrentTime ? Math.min(endTs, virtualTs) : endTs;
      }

      if (!recordsetLength) {
        await this.skipGap();
      }

      const payloadAfter: IEmAfterLoadNextPortion = {
        streamId,
        startTs,
        endTs,
        timeDelayMillis,
        limit,
        lastRecordTs: this.lastRecordTs,
        nextStartTs: this.nextStartTs,
        recordsetLength,
        isLimitExceed,
        last: recordsBuffer.last,
        vt: virtualTimeObj.virtualTs,
        lastSpeed: virtualTimeObj.lastSpeed,
        totalSpeed: virtualTimeObj.totalSpeed,
        stat,
      };
      localEventEmitter.emit('after-lnp', payloadBefore);
      if (DEBUG_LNP) {
        options.eventEmitter?.emit('after-load-next-portion', payloadAfter);
      }
    } catch (err: Error | any) {
      err.message += `\n${this.db.schemaAndTable}`;
      options.exitOnError(err);
    }
  }

  private async skipGap () {
    if (!this.options.skipGaps || this.virtualTimeObj.isCurrentTime) {
      return;
    }
    const { lastRecordTs, nextStartTs } = this;
    if (this.prevLastRecordTs === lastRecordTs) {
      this.noRecordsQueryCounter++;
    } else {
      this.noRecordsQueryCounter = 0;
    }
    this.prevLastRecordTs = lastRecordTs;
    if (this.noRecordsQueryCounter < 2) {
      return;
    }

    const nextTs = await this.db.getNextRecordTs(this.nextStartTs);
    this.noRecordsQueryCounter = 0;
    if (!nextTs) {
      return;
    }
    this.nextStartTs = this.tsFieldToMillis(nextTs);
    if (DEBUG_LNP) {
      const payload: IEmFindNextTs = {
        streamId: this.options.streamConfig.streamId,
        o: nextStartTs,
        n: this.nextStartTs,
      };
      this.options.eventEmitter?.emit('find-next-ts', payload);
    }
  }

  private _fetchLoop () {
    const { options: { echo, streamConfig } } = this;
    cron.job(`0/${streamConfig.fetchIntervalSec} * * * * *`, async () => {
      if (this.locked) {
        if (DEBUG_STREAM) {
          const vt = `vt: ${this.virtualTimeObj.virtualTimeString} ${this.virtualTimeObj.locked ? `${bg.red}${yellow}LOCKED${rs}` : ''}}`;
          echo(`${this.prefix} ${bg.red}${yellow}STREAM LOCKED${rs} ${vt}`);
        }
        return;
      }
      if (this.busy === 0 || this.busy > 5) {
        this.busy = 1;
        try {
          await this._loadNextPortion();
        } catch (err: Error | any) {
          this.options.exitOnError(err);
          return;
        }
        this.busy = 0;
      } else {
        this.busy++;
      }
    }, null, true, 'GMT', undefined, false);
    // onComplete, start, timeZone, context, runOnInit
  }

  private _printInfoLoop () {
    clearTimeout(this._printTimer);

    const rowsSent = `rows sent: ${bold}${padL(this.totalRowsSent || 0, 6)}${boldOff}${rs}`;
    const locked = this.locked ? `  ${bg.red}${yellow}STREAM LOCKED${rs}` : '';
    this.options.logger?.info(`${this.prefix} ${rowsSent} / ${this.virtualTimeObj.virtualTimeString}${locked} / ${memUsage()}`);

    const self = this;
    this._printTimer = setTimeout(() => {
      self._printInfoLoop();
    }, (this.options.streamConfig.printInfoIntervalSec || DEFAULTS.PRINT_INFO_INTERVAL_SEC) * 1000);
  }

  // #################################  SEND  ##################################

  private async _sendPacket (eventsPacket: TEventRecord[]): Promise<{ debugMessage: string, isError?: boolean }> {
    const { sender, sessionId, options: { eventEmitter, logger, streamConfig: { streamId } } } = this;
    return new Promise((resolve: Function) => {
      let debugMessage = '';

      const timer = setTimeout(() => {
        clearTimeout(timer);
        if (DEBUG_STREAM) {
          debugMessage += `${this.prefix}`;
        }
        const first = eventsPacket[0];
        const recordsComposite: IRecordsComposite = {
          sessionId,
          streamId,
          eventsPacket,
          isSingleRecordAsObject: true,
          first,
          last: first,
        };
        sender.sendEvents(recordsComposite).then(() => {
          const { last, sendCount = 0, sentBufferLength } = recordsComposite;
          const lastTs = last?.[TS_FIELD];
          if (lastTs) {
            const payload: IEmSaveLastTs = { streamId, lastTs };
            eventEmitter.emit('save-last-ts', payload);
          }
          this.totalRowsSent += sendCount;
          if (DEBUG_STREAM) {
            debugMessage += ` SENT: ${c}${Stream.packetInfo(sendCount, first, last)}`;
            debugMessage += ` / ${padL(sentBufferLength, 6)}b`;
            debugMessage += ` / r.tot: ${bold}${padL(this.totalRowsSent, 6)}${boldOff}${rs}`;
          }
          resolve({ debugMessage });
        }).catch((err: Error | any) => {
          logger.error(err);
          resolve({ debugMessage, isError: true });
        });
      }, 5);
    });
  }

  private async _send () {
    const { recordsBuffer: rb, virtualTimeObj } = this;
    if (virtualTimeObj.locked) {
      return;
    }

    virtualTimeObj.setNextTimeFront();

    const index = this.findEndIndex(virtualTimeObj.virtualTs);
    if (index < 0) {
      return;
    }

    const eventsPacket: any[] | null = rb.shiftBy(index + 1);

    let debugMessage;
    if (eventsPacket.length) {
      ({ debugMessage } = await this._sendPacket(eventsPacket));
      if (eventsPacket.length) {
        rb.unshiftEvents(eventsPacket);
      }
    }
    if (DEBUG_STREAM) {
      let bufferInfo = Stream.packetInfo(rb.length, rb.first, rb.last);
      bufferInfo = bufferInfo.trim() ? `BUFFER: ${bufferInfo}` : `BUFFER empty`;
      this.options.echo(`${debugMessage}\t${m}${bufferInfo}`);
    }
  }

  private async _sendLoop () {
    const self = this;
    clearTimeout(this._sendTimer);
    try {
      await this._send();
    } catch (err: Error | any) {
      return self.options.exitOnError(err);
    }
    this._sendTimer = setTimeout(() => {
      self._sendLoop();
    }, this.options.streamSendIntervalMillis);
  }

  // #################################  LOCK  ##################################

  lock (lockVirtualTime?: boolean) {
    this.locked = true;
    if (lockVirtualTime) {
      this.virtualTimeObj.lock();
    }
  }

  unLock (unlockVirtualTime?: boolean) {
    this.locked = false;
    if (unlockVirtualTime) {
      this.virtualTimeObj.unLock();
    }
  }

  // ===========================================================================

  setEventCallback (eventCallback: Function) {
    this.sender.eventCallback = eventCallback;
  }

  getDesiredTimeFront (timeFront: number, timeShift: number) {
    const { firstTs } = this.recordsBuffer;
    if (firstTs) {
      // Если буфер не пуст:
      // Не допускаем увеличение разницы между ts первого элемента и виртуальным временем боле, чем на maximumRunUp...
      return firstTs + (this.options.maxRunUpFirstTsVtMillis || DEFAULTS.MAX_RUNUP_FIRST_TS_VT_MILLIS);
    }
    if (this.nextStartTs) {
      // Если буфер пуст
      return this.nextStartTs + this.sendIntervalVirtualMillis;
    }
    return timeFront + timeShift;
  }

  getActualConfig (asString?: boolean): string | IStreamConstructorOptions {
    const optionsCopy = cloneDeep<IStreamConstructorOptions>(this.options);
    ['logger', 'echo', 'exitOnError', 'eventEmitter', 'prepareEvent', 'tsFieldToMillis', 'millis2dbFn'].forEach((p) => {
      delete optionsCopy[p];
    });
    delete optionsCopy.senderConfig.eventCallback;
    if (asString) {
      return JSON.stringify(optionsCopy, undefined, 2);
    }
    return optionsCopy;
  }

  stop () {
    this.lock(true);
    this.virtualTimeObj.init();

    this.lastRecordTs = 0;
    this.nextStartTs = this.virtualTimeObj.virtualStartTs;
    this.recordsBuffer.flush();
    this.lastTimeRecords.flush();
    this.totalRowsSent = 0;
    this.isFirstLoad = true;

    this.prevLastRecordTs = 0;
    this.noRecordsQueryCounter = 0;

    clearTimeout(this._sendTimer);
    clearTimeout(this._printTimer);
    this.stat = getInitStat();
  }
}
