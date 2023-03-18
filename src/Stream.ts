import EventEmitter from 'events';
import { DateTime } from 'luxon';
import * as cron from 'cron';
import { Promise } from 'mssql';
import { LastTimeRecords } from './LastTimeRecords';
import { RecordsBuffer } from './RecordsBuffer';
import { IStartTimeRedisOptions, StartTimeRedis } from './StartTimeRedis';
import { getVirtualTimeObj, IVirtualTimeObjOptions, VirtualTimeObj } from './VirtualTimeObj';
import { copyRecord, getTimeParamMillis, memUsage, millis2iso, millis2isoZ, padL } from './utils/utils';
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
import { DEBUG_LNP, DEBUG_LTR, DEBUG_STREAM, TS_FIELD } from './constants';

const FETCH_INTERVAL_SEC_DEFAULT = 10;
const BUFFER_MULTIPLIER_DEFAULT = 2;
const MAX_BUFFER_SIZE_DEFAULT = 65_000;
const STREAM_SEND_INTERVAL_DEFAULT_MILLIS = 10;

export interface IStreamConstructorOptions {
  streamConfig: IStreamConfig,
  senderConfig: ISenderConfig,
  serviceName: string,
  redis: {
    host: string,
    port: string | number
  },
  logger: ILoggerEx,
  echo: IEcho,
  exitOnError: Function,
  eventEmitter: EventEmitter,

  useStartTimeFromRedisCache: boolean,
  speed?: number,
  loopTime?: string | number,
  prepareEvent?: Function,
  tsFieldToMillis?: Function,
  millis2dbFn?: Function,
  skipGaps?: boolean, // skip gaps in data when working in virtual time mode
  streamSendIntervalMillis?: number, // default 10 ms
  speedCalcIntervalMillis?: number, // default 10_000 ms
  timeFrontUpdateIntervalMillis?: number, // default 5 ms
  testMode?: boolean,
  timeDelayMillis?: number, // Искусственное отставание при выборке данных
}

export class Stream {
  public bufferLookAheadMs: number;

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

  public readonly options: IStreamConstructorOptions;

  public sender: ISender;

  public readonly sessionId: string = `sid${+(new Date())}`;

  public db: DbMsSql | DbPostgres;

  public locked: boolean = false;

  private loopTimeMillis: number;

  private busy: number;

  private sendTimer: any;

  public speed: number = 1;

  /**
   * The interval for sending data from the buffer
   */
  private readonly streamSendIntervalMillis: number;

  /**
   * The interval for sending data from the buffer multiplied by the speed of virtual time
   */
  public sendIntervalVirtualMillis: number;

  public totalRowsSent: number;

  private readonly tsFieldToMillis: Function;

  private readonly prepareEvent: Function;

  private readonly millis2dbFn: Function;

  private initialized: boolean = false;

  private isFirstLoad: boolean = true;

  private maxBufferSize: number;

  //-----------------------------------------
  private readonly skipGaps: boolean = false;

  private prevLastRecordTs: number;

  private noRecordsQueryCounter: number;
  //-----------------------------------------

  public prefix: string;

  public stat: IStreamStat = { queryTs: 0 };

  private isPrepareEventAsync: boolean;

  private timeDelayMillis: number = 0;

  constructor (options: IStreamConstructorOptions) {
    const { streamConfig, prepareEvent, tsFieldToMillis, millis2dbFn, loopTime = 0 } = options;
    const { src, maxBufferSize } = streamConfig;
    src.timezoneOfTsField = src.timezoneOfTsField || 'GMT';
    const zone = src.timezoneOfTsField;
    this.options = options;

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
    const fetchIntervalSec = streamConfig.fetchIntervalSec || FETCH_INTERVAL_SEC_DEFAULT; // by default polling 1 time per 10 sec
    streamConfig.fetchIntervalSec = fetchIntervalSec;
    const bufferMultiplier = Math.min(streamConfig.bufferMultiplier || BUFFER_MULTIPLIER_DEFAULT, 1); // Default x2, but not less than 1
    this.speed = Number(options.speed) || 1;

    // Запрос данных со сдвигом виртуального времени на bufferMultiplier интервалов опроса
    this.bufferLookAheadMs = fetchIntervalSec * 1000 * bufferMultiplier * this.speed;
    this.maxBufferSize = maxBufferSize || MAX_BUFFER_SIZE_DEFAULT; // Default 65_000;
    this.sender = {} as ISender;
    this.db = {} as DbMsSql | DbPostgres;
    this.lastRecordTs = 0;
    this.nextStartTs = 0;

    // Properties for Jumping Data Breaks
    this.skipGaps = !!options.skipGaps;
    this.prevLastRecordTs = 0;
    this.noRecordsQueryCounter = 0;

    this.loopTimeMillis = getTimeParamMillis(loopTime);
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

    this.sendTimer = null;
    this.streamSendIntervalMillis = options.streamSendIntervalMillis || STREAM_SEND_INTERVAL_DEFAULT_MILLIS;
    this.sendIntervalVirtualMillis = this.streamSendIntervalMillis * this.speed;
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
      this.sendIntervalVirtualMillis = this.streamSendIntervalMillis; // not really needed
      this.bufferLookAheadMs = fetchIntervalSec * 1000 * bufferMultiplier;
    });

    this.prefix = `${lCyan}STREAM: ${lBlue}${options.streamConfig.streamId}${rs}`;
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
    const { options: streamConstructorOptions, loopTimeMillis, millis2dbFn, speed } = this;
    const {
      senderConfig,
      eventEmitter,
      echo,
      logger,
      redis,
      serviceName,
      streamConfig,
      useStartTimeFromRedisCache,
      exitOnError,
      testMode,
      speedCalcIntervalMillis,
      timeFrontUpdateIntervalMillis,
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
    const { host, port } = redis;
    const { src: { dbOptions, dbConfig, timezoneOfTsField }, streamId } = streamConfig;
    const startTimeRedisOptions: IStartTimeRedisOptions = {
      useStartTimeFromRedisCache,
      host,
      port,
      streamId,
      eventEmitter,
      exitOnError,
      logger,
    };
    const startTimeRedis = new StartTimeRedis(startTimeRedisOptions);

    const { isUsedSavedStartTime, startTime } = await startTimeRedis.getStartTime();

    const virtualTimeObjOptions: IVirtualTimeObjOptions = {
      startTime,
      eventEmitter,
      speed,
      loopTimeMillis,
      echo,
      exitOnError,
      speedCalcIntervalMillis,
      timeFrontUpdateIntervalMillis,
    };

    this.virtualTimeObj = getVirtualTimeObj(virtualTimeObjOptions);
    this.virtualTimeObj.registerStream(this);
    this.nextStartTs = this.virtualTimeObj.virtualStartTs;

    const eqFill = '='.repeat(Math.max(1, (36 - streamId.length) / 2));
    const info = `${g}${eqFill} [af-streams: ${streamId}] ${eqFill}
${g}Time field TZ:         ${m}${timezoneOfTsField}
${g}Start from beginning:  ${m}${useStartTimeFromRedisCache ? 'NOT' : 'YES'}
${g}Start time:            ${m}${millis2isoZ(startTime)}${isUsedSavedStartTime ? `${y}${bold} TAKEN FROM CACHE${boldOff}${rs}${g}` : ''}
${g}Speed:                 ${m}${this.virtualTimeObj.speed} X
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
    if (!this.initialized) {
      await this.init();
    }
    await this._loadNextPortion();
    this._fetchLoop();
    this._printInfoLoop();
    // Additional external call loop in case of interruption of the chain of internal calls _sendLoop()
    setInterval(() => {
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
    const { options: { streamConfig: { src: { tsField } } }, prepareEvent, isPrepareEventAsync, tsFieldToMillis } = this;
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

      const recordCopy = copyRecord(record); // VVQ возможно упразднить
      recordCopy[TS_FIELD] = tsFieldToMillis(record[tsField]);

      return new Promise((resolve: (arg0: TEventRecord | null) => void) => {
        const timerId = setTimeout(() => {
          resolve(null);
        }, TIMEOUT_TO_PREPARE_EVENT);
        if (isPrepareEventAsync) {
          prepareEvent(recordCopy).then((eventRecord: TEventRecord) => {
            resolve(eventRecord);
            clearTimeout(timerId);
          });
        } else {
          const eventRecord = prepareEvent(recordCopy);
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

  private async _loadNextPortion () {
    const {
      options, recordsBuffer, virtualTimeObj, bufferLookAheadMs, nextStartTs, maxBufferSize, stat, speed, timeDelayMillis,
    } = this;
    const { streamConfig: { streamId } } = options;

    // Если расстояние по времени от первой до последней записи в буфере больше bufferLookAheadMs, новых записей подгружать не нужно
    if (((recordsBuffer.getMsDistance()) >= bufferLookAheadMs)) {
      return;
    }

    virtualTimeObj.setNextTimeFront();

    // Если время начала следующего запроса находится впереди текущего виртуального времени более,
    // чем на расстояние bufferLookAheadMs, новых записей подгружать не нужно
    if (nextStartTs - virtualTimeObj.virtualTs >= bufferLookAheadMs) {
      return;
    }

    let startTs = nextStartTs;
    let endTs = virtualTimeObj.virtualTs + bufferLookAheadMs + (stat.queryTs * speed); // С учетом предыдущих условий, тут расстояние между startTs и endTs не должно превышать

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
    const limit = maxBufferSize - recordsBuffer.buffer.length;
    if (limit < 1) {
      return;
    }

    try {
      if (DEBUG_LNP) {
        const payload: IEmBeforeLoadNextPortion = { streamId, startTs, endTs, vt: virtualTimeObj.virtualTs, timeDelayMillis };
        options.eventEmitter?.emit('before-load-next-portion', payload);
      }
      const st = Date.now();
      // ================= get Portion Of Data =================
      let recordset: TDbRecord[] | null = await this.db.getPortionOfData({ startTs, endTs, limit, timeDelayMillis });
      // =======================================================
      stat.queryTs = Date.now() - st;

      const recordsetLength = recordset?.length || 0;
      await this._addPortionToBuffer(recordset); // Inside the function recordset is cleared
      recordset = null; // GC

      const isLimitExceed = recordsetLength >= limit;

      this.nextStartTs = isLimitExceed && this.lastRecordTs ? this.lastRecordTs : endTs;
      if (!recordsetLength) {
        await this.skipGap();
      }

      if (DEBUG_LNP) {
        const payload: IEmAfterLoadNextPortion = {
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
        options.eventEmitter?.emit('after-load-next-portion', payload);
      }
    } catch (err: Error | any) {
      err.message += `\n${this.db.schemaAndTable}`;
      options.exitOnError(err);
    }
  }

  private async skipGap () {
    if (!this.skipGaps || this.virtualTimeObj.isCurrentTime) {
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
    const { streamConfig, logger } = this.options;
    cron.job(`0/${streamConfig.printInfoIntervalSec || 30} * * * * *`, () => {
      const rowsSent = `rows sent: ${bold}${padL(this.totalRowsSent || 0, 6)}${boldOff}${rs}`;
      const locked = this.locked ? `  ${bg.red}${yellow}STREAM LOCKED${rs}` : '';
      logger.info(`${this.prefix} ${rowsSent} / ${this.virtualTimeObj.virtualTimeString}${locked} / ${memUsage()}`);
    }, null, true, 'GMT', undefined, false);
    // onComplete, start, timeZone, context, runOnInit
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

    let eventsPacket: any[] | null = rb.shiftBy(index + 1);

    let debugMessage;
    if (eventsPacket.length) {
      ({ debugMessage } = await this._sendPacket(eventsPacket));
      if (eventsPacket.length) {
        rb.unshiftEvents(eventsPacket);
      }
      eventsPacket.splice(0, eventsPacket.length); // GC
    }
    eventsPacket = null; // GC
    if (DEBUG_STREAM) {
      let bufferInfo = Stream.packetInfo(rb.length, rb.first, rb.last);
      bufferInfo = bufferInfo.trim() ? `BUFFER: ${bufferInfo}` : `BUFFER empty`;
      this.options.echo(`${debugMessage}\t${m}${bufferInfo}`);
    }
  }

  private async _sendLoop () {
    const self = this;
    clearTimeout(this.sendTimer);
    try {
      await this._send();
    } catch (err: Error | any) {
      return self.options.exitOnError(err);
    }
    this.sendTimer = setTimeout(() => {
      self._sendLoop();
    }, this.streamSendIntervalMillis);
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
    // Если буфер не пуст, то надо не допускать превышения времени отставания выше порога
    const MAX_LAG = 30_000; // 30 с, как 1/120 часа
    const { firstTs } = this.recordsBuffer;
    if (firstTs) {
      return firstTs + MAX_LAG;
    }
    if (this.nextStartTs) {
      return this.nextStartTs + this.sendIntervalVirtualMillis;
    }
    return timeFront + timeShift;
  }

  setTimeDelay (timeDelayMillis: number) {
    this.timeDelayMillis = Math.max(0, timeDelayMillis);
  }
}
