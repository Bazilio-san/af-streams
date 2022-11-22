import EventEmitter from 'events';
import { DateTime } from 'luxon';
import * as cron from 'cron';
import { Promise } from 'mssql';
import { LastTimeRecords } from './LastTimeRecords';
import { RecordsBuffer } from './RecordsBuffer';
import { IStartTimeRedisOptions, StartTimeRedis } from './StartTimeRedis';
import { getVirtualTimeObj, IVirtualTimeObjOptions, VirtualTimeObj } from './VirtualTimeObj';
import { getTimeParamMillis, millis2iso, padL } from './utils/utils';
import getDb from './db/db';
import {
  blue, bold, boldOff, c, g, lBlue, lc, lCyan, lm, m, rs, y, bg, yellow,
} from './utils/color';
import {
  IDbConstructorOptions,
  IEcho, IEmAfterLoadNextPortion, IEmBeforeLoadNextPortion,
  IEmCurrentLastTimeRecords, IEmSaveLastTs,
  IEmSubtractedLastTimeRecords,
  ILoggerEx,
  IRecordsComposite,
  ISender,
  ISenderConfig,
  ISenderConstructorOptions,
  IStreamConfig,
  TDbRecord,
  TEventRecord,
} from './interfaces';
import { DbMsSql } from './db/DbMsSql';
import { DbPostgres } from './db/DbPostgres';
import getSender from './sender/get-sender';
import { DEBUG_LNP, DEBUG_LTR, DEBUG_STREAM, TS_FIELD } from './constants';

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
  testMode?: boolean,
}

export class Stream {
  public readonly bufferLookAheadMs: number;

  public lastRecordTs: number;

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

  private readonly sendInterval: number;

  public totalRowsSent: number;

  private readonly tsFieldToMillis: Function;

  private readonly prepareEvent: Function;

  private readonly millis2dbFn: Function;

  private initialized: boolean = false;

  private isFirstLoad: boolean = true;

  private maxBufferSize: number;

  public prefix: string;

  constructor (options: IStreamConstructorOptions) {
    const { streamConfig, prepareEvent, tsFieldToMillis, millis2dbFn, loopTime = 0 } = options;
    const { fetchIntervalSec, bufferMultiplier, src, maxBufferSize } = streamConfig;
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

    this.millis2dbFn = typeof millis2dbFn === 'function'
      ? millis2dbFn.bind(this)
      : (millis: number) => `'${millis2iso(millis)}'`;

    const { idFields } = src;
    this.bufferLookAheadMs = ((fetchIntervalSec || 10) * 1000 * (bufferMultiplier || 30));
    this.maxBufferSize = maxBufferSize || 65_536;

    this.sender = {} as ISender;
    this.db = {} as DbMsSql | DbPostgres;
    this.lastRecordTs = 0;

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
    this.sendInterval = 10; // ms
    this.totalRowsSent = 0;
    this.busy = 0;
    options.eventEmitter?.on('virtual-time-loop-back', () => {
      this.lastRecordTs = 0;
      this.recordsBuffer.flush();
      this.lastTimeRecords.flush();
      this.totalRowsSent = 0;
      this.isFirstLoad = true;
    });
    this.prefix = `${lCyan}STREAM: ${lBlue}${options.streamConfig.streamId}${rs}`;
  }

  async init (): Promise<Stream | undefined> {
    const { options, loopTimeMillis, millis2dbFn } = this;
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
    } = options;

    let { speed } = options;
    if (/^[\d.]+$/.test(String(speed))) {
      speed = Math.min(Math.max(0.2, parseFloat(String(speed))), 5000);
    } else {
      speed = 1;
    }

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
    const { src: { dbOptions, dbConfig, timezoneOfTsField }, streamId, fetchIntervalSec } = streamConfig;
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
      speed,
      loopTimeMillis,
      eventEmitter,
      exitOnError,
    };
    this.virtualTimeObj = getVirtualTimeObj(virtualTimeObjOptions);

    const eqFill = '='.repeat(Math.max(1, (36 - streamId.length) / 2));
    const info = `${g}${eqFill} [@bazilio-san/af-stream: ${streamId}] ${eqFill}
${g}Time field TZ:         ${m}${timezoneOfTsField}
${g}Start from beginning:  ${m}${useStartTimeFromRedisCache ? 'NOT' : 'YES'}
${g}Start time:            ${m}${millis2iso(startTime)}${isUsedSavedStartTime ? `${y}${bold} TAKEN FROM CACHE${boldOff}${rs}${g}` : ''}
${g}Speed:                 ${m}${this.virtualTimeObj.speed}x
${g}Cyclicity:             ${m}${loopTimeMillis ? `${loopTimeMillis / 1000} sec` : '-'}
${g}Db polling frequency:  ${m}${fetchIntervalSec} sec
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

  // Greatest index of a value less than the specified
  findEndIndex () {
    const virtualTime = this.virtualTimeObj.getVirtualTs();
    /*
    if (DEBUG_STREAM) {
      const { buffer: rb } = this.recordsBuffer;
      const firstISO = rb.length ? millis2iso(rb[0][TS_FIELD]) : '-';
      const lastISO = rb.length > 1 ? millis2iso(rb[rb.length - 1][TS_FIELD]) : '-';
        this.options.echo(`findEndIndex() ${c}virtualTime: ${m}${millis2iso(virtualTime)}${rs} [${m}${firstISO}${rs} - ${m}${lastISO}${rs}]`);
    }
    */
    return this.recordsBuffer.findIndexOfNearestSmaller(virtualTime);
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

  async prepareEventsPacket (dbRecordOrRecordset: TDbRecord[]): Promise<TEventRecord[]> {
    const { options: { streamConfig: { src: { tsField } } }, prepareEvent, tsFieldToMillis } = this;
    if (!Array.isArray(dbRecordOrRecordset)) {
      if (!dbRecordOrRecordset || typeof dbRecordOrRecordset !== 'object') {
        return [];
      }
      dbRecordOrRecordset = [dbRecordOrRecordset];
    }

    return Promise.all(dbRecordOrRecordset.map((record) => {
      record[TS_FIELD] = tsFieldToMillis(record[tsField]);
      return prepareEvent(record);
    }));
  }

  async _addPortionToBuffer (recordset: TDbRecord[]) {
    const { recordsBuffer, loopTimeMillis, options } = this;
    const { streamConfig: { streamId } } = options;
    const { length: loaded = 0 } = recordset;
    let skipped = 0;
    let toUse = loaded;
    if (loaded) {
      const forBuffer = await this.prepareEventsPacket(recordset);

      if (loopTimeMillis) {
        const bias = Date.now() - this.virtualTimeObj.realStartTsLoopSafe;
        forBuffer.forEach((row) => {
          row._ts = row[TS_FIELD] + bias;
          row.loopNumber = this.virtualTimeObj.loopNumber;
        });
      }

      const lastRecordTsBeforeCheck = forBuffer[forBuffer.length - 1][TS_FIELD];

      const subtractedLastTimeRecords = this.lastTimeRecords.subtractLastTimeRecords(forBuffer);
      if (DEBUG_LTR) {
        const payload: IEmSubtractedLastTimeRecords = { streamId, subtractedLastTimeRecords };
        options.eventEmitter?.emit('subtracted-last-time-records', payload);
      }

      toUse = forBuffer.length;
      if (toUse !== loaded) {
        skipped = loaded - toUse;
      }
      if (toUse) {
        recordsBuffer.add(forBuffer);
        this.lastRecordTs = recordsBuffer.lastTs;
        const currentLastTimeRecords = this.lastTimeRecords.fillLastTimeRecords(this.recordsBuffer.buffer);
        if (DEBUG_LTR) {
          const payload: IEmCurrentLastTimeRecords = { streamId, currentLastTimeRecords };
          options.eventEmitter?.emit('current-last-time-records', payload);
        }
      } else {
        this.lastRecordTs = lastRecordTsBeforeCheck + 1;
      }
    }
    if (DEBUG_STREAM) {
      options.echo(`${this.prefix} vt: ${this.virtualTimeObj.getString()} loaded/skipped/used: ${lm}${loaded}${blue}/${lc}${skipped}${blue}/${g}${toUse}${rs}`);
    }
  }

  async _loadNextPortion () {
    const { options, recordsBuffer, virtualTimeObj: vtObj, bufferLookAheadMs, lastRecordTs, maxBufferSize } = this;
    const { streamConfig: { streamId } } = options;
    const virtualTimeObj = vtObj as VirtualTimeObj;

    let startTs;
    let endTs;
    if (this.isFirstLoad) {
      startTs = virtualTimeObj.virtualStartTs;
      endTs = startTs + bufferLookAheadMs;
      this.isFirstLoad = false;
    } else {
      startTs = lastRecordTs || virtualTimeObj.virtualStartTs;
      endTs = virtualTimeObj.getVirtualTs() + bufferLookAheadMs;
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

    if (DEBUG_LNP) {
      options.echo(`${this.prefix} ${c}_loadNextPortion()${rs} vt: ${m}${virtualTimeObj.getString()}${rs
      } from: ${m}${millis2iso(startTs)}${rs} to ${m}${millis2iso(endTs)}${rs}`);
    }
    try {
      if (DEBUG_LNP) {
        const payload: IEmBeforeLoadNextPortion = { streamId, startTs, endTs };
        options.eventEmitter?.emit('before-load-next-portion', payload);
      }
      const recordset = await this.db.getPortionOfData({ startTs, endTs, limit });
      if (recordset.length) {
        endTs = this.tsFieldToMillis(recordset[recordset.length - 1][options.streamConfig.src.tsField]);
      }
      await this._addPortionToBuffer(recordset);
      if (DEBUG_LNP) {
        const payload: IEmAfterLoadNextPortion = {
          streamId,
          startTs,
          endTs,
          lastRecordTs: this.lastRecordTs,
          last: recordsBuffer.last,
          vt: virtualTimeObj.getVirtualTs(),
        };
        options.eventEmitter?.emit('after-load-next-portion', payload);
      }
    } catch (err: Error | any) {
      err.message += `\n${this.db.schemaAndTable}`;
      options.exitOnError(err);
    }
  }

  _fetchLoop () {
    const { options: { streamConfig } } = this;
    cron.job(`0/${streamConfig.fetchIntervalSec || 10} * * * * *`, async () => {
      if (this.locked) {
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

  _printInfoLoop () {
    const { streamConfig, logger } = this.options;
    cron.job(`0/${streamConfig.printInfoIntervalSec || 30} * * * * *`, () => {
      const rowsSent = `rows sent: ${bold}${padL(this.totalRowsSent || 0, 6)}${boldOff}${rs}`;
      const locked = this.locked ? `  ${bg.red}${yellow}STREAM LOCKED${rs}` : '';
      logger.info(`${this.prefix} ${rowsSent} / ${this.virtualTimeObj.getString()}${locked}`);
    }, null, true, 'GMT', undefined, false);
    // onComplete, start, timeZone, context, runOnInit
  }

  async _sendPacket (eventsPacket: TEventRecord[]): Promise<{ debugMessage: string, isError?: boolean }> {
    const { sender, sessionId, options: { eventEmitter, logger, streamConfig: { streamId } } } = this;
    return new Promise((resolve: Function) => {
      let debugMessage = '';

      setTimeout(() => {
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

  async _send () {
    const { recordsBuffer: rb, virtualTimeObj } = this;
    if (!virtualTimeObj.ready) {
      return;
    }
    const index = this.findEndIndex();
    if (index < 0) {
      return;
    }
    const eventsPacket = rb.shiftBy(index + 1);
    let debugMessage;
    if (eventsPacket.length) {
      ({ debugMessage } = await this._sendPacket(eventsPacket));
      if (eventsPacket.length) {
        rb.unshiftEvents(eventsPacket);
      } else {
        rb.setEdges();
      }
    }
    if (DEBUG_STREAM) {
      let bufferInfo = Stream.packetInfo(rb.length, rb.first, rb.last);
      bufferInfo = bufferInfo.trim() ? `BUFFER: ${bufferInfo}` : `BUFFER empty`;
      this.options.echo(`${debugMessage}\t${m}${bufferInfo}`);
    }
  }

  async _sendLoop () {
    const self = this;
    clearTimeout(this.sendTimer);
    try {
      await this._send();
    } catch (err: Error | any) {
      return self.options.exitOnError(err);
    }
    this.sendTimer = setTimeout(() => {
      self._sendLoop();
    }, this.sendInterval);
  }

  setEventCallback (eventCallback: Function) {
    this.sender.eventCallback = eventCallback;
  }

  lock () {
    this.locked = true;
  }

  unLock () {
    this.locked = false;
  }
}
