// noinspection JSUnusedGlobalSymbols

import { DateTime } from 'luxon';
import { clearInterval } from 'timers';
import {
  blue, bold, boldOff, c, g, lBlue, lc, lCyan, lm, m, rs, bg, yellow, black,
} from 'af-color';
import { cloneDeep, infoBlock, memUsage, padL } from 'af-tools-ts';
import { LastTimeRecords } from './LastTimeRecords';
import { RecordsBuffer } from './RecordsBuffer';
import { VirtualTimeObj } from './VirtualTimeObj';
import getDb from './db/db';
import {
  ICommonConfig, IEmBeforeLoadNextPortion,
  IEmCurrentLastTimeRecords, IEmFindNextTs,
  IEmSubtractedLastTimeRecords,
  IRecordsComposite,
  ISender,
  ISenderConfig,
  IStreamConfig, IStreamStat,
  TDbRecord,
  TEventRecord,
} from './interfaces';
import { DbMsSql } from './db/DbMsSql';
import { DbPostgres } from './db/DbPostgres';
import { destroySender, getSender } from './sender/get-sender';
import { DEBUG_LNP, DEBUG_LTR, DEBUG_STREAM, STREAM_CONFIG_DEFAULTS, STREAM_ID_FIELD, TS_FIELD } from './constants';
import { PARAMS } from './params';

export interface IStreamConstructorOptions {
  commonConfig: ICommonConfig,
  streamConfig: IStreamConfig,
  senderConfig: ISenderConfig,

  virtualTimeObj: VirtualTimeObj,
}

const getInitStat = (obj?: any): IStreamStat => ({
  streamId: '',
  startTs: 0, // Left time limit in last request
  endTs: 0, // Right time limit in last request
  timeDelayMillis: 0,
  limit: 0, // Timestamp of the last received record
  lastRecordTs: 0, // Left border for next request
  nextStartTs: 0,
  recordsetLength: 0,
  isLimitExceed: false,
  last: null,
  vt: 0, // Virtual time stamp
  lastSpeed: 0,
  totalSpeed: 0,
  queryDurationMillis: 0,
  ...obj,
});

const TIMEOUT_TO_PREPARE_EVENT = 10_000;

// noinspection JSConstantReassignment
export class Stream {
  id: string;

  color: string = black;

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

  private busy: number = 0;

  private _sendTimer: any;

  private _sendInterval: any;

  private _printTimer: any;

  private _fetchLoopTimer: any;

  /**
   * The interval for sending data from the buffer multiplied by the speed of virtual time
   */
  public sendIntervalVirtualMillis: number = 10;

  public totalRowsSent: number;

  private tsFieldToMillis: Function;

  private prepareEvent: Function;

  private initialized: boolean = false;

  private isFirstLoad: boolean = true;

  //-----------------------------------------
  private prevLastRecordTs: number;

  private noRecordsQueryCounter: number;
  //-----------------------------------------

  public prefix: string;

  public stat: IStreamStat;

  private isPrepareEventAsync: boolean;

  private destroyed: boolean = false;

  public eeListeners: { [eventId: string]: (...args: any[]) => any } = {};

  gapEdge: number = 0;

  constructor (public options: IStreamConstructorOptions) {
    this.virtualTimeObj = options.virtualTimeObj;
    const { streamConfig } = options;
    const { streamId, src, prepareEvent, tsFieldToMillis } = streamConfig;
    this.id = streamId;
    src.timezoneOfTsField = src.timezoneOfTsField || 'GMT';

    const tsFieldToMillisDefault = (tsValue: string | Date | number) => {
      if (typeof tsValue === 'string') {
        return DateTime.fromISO(tsValue, { zone: src.timezoneOfTsField }).toMillis();
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

    this.sender = {} as ISender;
    this.db = null as unknown as DbMsSql | DbPostgres;
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
    this.lastTimeRecords = new LastTimeRecords(src.idFields);

    this._sendTimer = null;
    this._sendInterval = null;
    this.totalRowsSent = 0;

    this.eeListeners['virtual-time-loop-back'] = () => {
      this.lastRecordTs = 0;
      this.nextStartTs = this.virtualTimeObj.virtualStartTs;
      this.recordsBuffer.flush();
      this.lastTimeRecords.flush();
      this.totalRowsSent = 0;
      this.isFirstLoad = true;
    };

    this.eeListeners['virtual-time-is-synchronized-with-current'] = () => {
      this.resetSendIntervalVirtualMillis();
    };
    const { eventEmitter: ee } = options.commonConfig;
    if (ee) {
      Object.entries(this.eeListeners).forEach(([eventId, fn]) => {
        ee.on(eventId, fn);
      });
    }

    this.prefix = `${lCyan}STREAM: ${lBlue}${streamId}${rs}`;
    this.stat = getInitStat({ streamId });
  }

  // ####################################  SET  ################################
  setParam (paramName: string, value?: number): number {
    const isEcho = typeof value === 'number';
    const p = this.options.streamConfig;
    if (!isEcho) {
      // @ts-ignore
      value = (Number(p[paramName]) || STREAM_CONFIG_DEFAULTS[paramName]);
    }
    if (paramName === 'timeDelayMillis') {
      value = Math.max(value || 0, 0);
    }
    // @ts-ignore
    p[paramName] = value;
    if (isEcho) {
      this.options.commonConfig.echo(`Новое значение ${m}${paramName}${rs} = ${lBlue}${value}`);
    }
    return value as number;
  }

  setEventCallback (eventCallback: Function) {
    this.options.senderConfig.eventCallback = eventCallback;
    this.sender.eventCallback = eventCallback;
  }

  resetSendIntervalVirtualMillis () {
    this.sendIntervalVirtualMillis = PARAMS.streamSendIntervalMillis * (this.virtualTimeObj.isCurrentTime ? 1 : PARAMS.speed);
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
  async init (): Promise<Stream> {
    this.resetSendIntervalVirtualMillis();
    this.setParam('timeDelayMillis');

    const { commonConfig, streamConfig, senderConfig } = this.options;
    const { streamId, timeDelayMillis } = streamConfig;
    const { echo } = commonConfig;

    this.virtualTimeObj.registerStream(this);
    this.nextStartTs = this.virtualTimeObj.virtualStartTs;

    const info: [string, any][] = [
      ['Time field TZ', streamConfig.src.timezoneOfTsField],
      ['Db polling frequency', `${PARAMS.streamFetchIntervalSec} sec`],
      ['Buffer multiplier', PARAMS.streamBufferMultiplier],
      ['Buffer cleanup interval', `${PARAMS.streamSendIntervalMillis} ms`],
      ['Max RunUp ts-vt', `${PARAMS.maxRunUpFirstTsVtMillis} ms`],
    ];
    if (timeDelayMillis) {
      info.push(['Time delay in request', `${timeDelayMillis} ms`]);
    }

    infoBlock({
      echo,
      title: `[af-streams: ${m}${streamId}]${yellow}`,
      titleColor: yellow,
      padding: 0,
      info,
    });
    // SENDER
    this.sender = await getSender({ streamId, senderConfig, commonConfig });
    echo(`${yellow}${'-'.repeat(64)}${rs}`);

    if (!commonConfig.skipInitDbConnection && !this.db) {
      this.db = await getDb({ commonConfig, streamConfig });
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
    this._fetchLoop().then(() => 0);
    this._printInfoLoop();
    // Additional external call loop in case of interruption of the chain of internal calls _sendLoop()
    this._sendInterval = setInterval(() => {
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
      const firstISO = rb.length ? millisTo.iso._(rb[0][TS_FIELD]) : '-';
      const lastISO = rb.length > 1 ? millisTo.iso._(rb[rb.length - 1][TS_FIELD]) : '-';
        this.options.echo(`findEndIndex() ${c}virtualTime: ${m}${millisTo.iso._(virtualTime)}${rs} [${m}${firstISO}${rs} - ${m}${lastISO}${rs}]`);
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
    if (this.destroyed) {
      return [];
    }
    const { options: { streamConfig: { streamId, src: { tsField } } }, prepareEvent, isPrepareEventAsync, tsFieldToMillis } = this;
    if (!Array.isArray(dbRecordOrRecordset)) {
      if (!dbRecordOrRecordset || typeof dbRecordOrRecordset !== 'object') {
        return [];
      }
      dbRecordOrRecordset = [dbRecordOrRecordset];
    }

    const eventRecords = await Promise.all(dbRecordOrRecordset.map((record, index) => {
      if (!record) {
        return null;
      }
      dbRecordOrRecordset[index] = null;

      record[TS_FIELD] = tsFieldToMillis(record[tsField]);
      record[STREAM_ID_FIELD] = streamId;

      return new Promise((resolve: (_arg: TEventRecord | null) => void) => {
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
    return eventRecords.filter(Boolean) as TEventRecord[];
  }

  async _addPortionToBuffer (recordset: TDbRecord[]): Promise<void> {
    const { recordsBuffer, options, virtualTimeObj: { loopNumber } } = this;
    const { streamId } = options.streamConfig;
    const { length: loadedCount = 0 } = recordset;
    let skipped = 0;
    let toUseCount = loadedCount;

    if (loadedCount) {
      const forBuffer = await this.prepareEventsPacket(recordset);
      if (this.destroyed) {
        return;
      }
      recordset.splice(0, recordset.length);

      if (PARAMS.loopTimeMillis) {
        const bias = loopNumber * PARAMS.loopTimeMillis;
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
        options.commonConfig.eventEmitter?.emit('subtracted-last-time-records', payload);
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
          options.commonConfig.eventEmitter?.emit('current-last-time-records', payload);
        }
      }
    }
    if (DEBUG_STREAM) {
      options.commonConfig.echo(`${this.prefix} vt: ${this.virtualTimeObj.virtualTimeString
      } loaded/skipped/used: ${lm}${loadedCount}${blue}/${lc}${skipped}${blue}/${g}${toUseCount}${rs}`);
    }
  }

  // #################################  LOAD  ##################################
  getBufferLookAhead () {
    const { isCurrentTime } = this.virtualTimeObj;
    // Запрос данных со сдвигом виртуального времени на streamBufferMultiplier интервалов опроса
    return PARAMS.streamFetchIntervalSec * 1000 * Math.max(PARAMS.streamBufferMultiplier, 1) * (isCurrentTime ? 1 : PARAMS.speed);
  }

  private async _loadNextPortion () {
    if (this.destroyed) {
      return;
    }
    const { options, recordsBuffer, virtualTimeObj, stat } = this;
    let { nextStartTs } = this;
    const { streamId, timeDelayMillis = 0 } = options.streamConfig;

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
      this.gapEdge = nextStartTs;
      return;
    }
    let startTs = nextStartTs;
    let endTs = virtualTimeObj.virtualTs + bufferLookAheadMs + (stat.queryDurationMillis * (isCurrentTime ? 1 : PARAMS.speed));
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
    const limit = PARAMS.streamMaxBufferSize - recordsBuffer.buffer.length;
    if (limit < 1) {
      return;
    }

    try {
      const payloadBefore: IEmBeforeLoadNextPortion = { streamId, startTs, endTs, vt: virtualTimeObj.virtualTs, timeDelayMillis };
      const ee = options.commonConfig.eventEmitter;

      stat.startTs = startTs;
      stat.endTs = endTs;
      stat.vt = virtualTimeObj.virtualTs;
      stat.timeDelayMillis = timeDelayMillis;

      if (DEBUG_LNP) {
        ee?.emit('before-load-next-portion', payloadBefore);
      }
      const st = Date.now();
      // ================= get Portion Of Data =================
      const recordset: TDbRecord[] | null = await this.db.getPortionOfData({ startTs, endTs, limit, timeDelayMillis });
      // =======================================================
      const recordsetLength = recordset?.length || 0;
      const isLimitExceed = recordsetLength >= limit;

      stat.queryDurationMillis = Date.now() - st;
      stat.vt = virtualTimeObj.virtualTs;
      stat.limit = limit;
      stat.lastRecordTs = this.lastRecordTs;
      stat.nextStartTs = this.nextStartTs;
      stat.recordsetLength = recordsetLength;
      stat.isLimitExceed = isLimitExceed;
      stat.last = recordsBuffer.last;
      stat.lastSpeed = virtualTimeObj.lastSpeed;
      stat.totalSpeed = virtualTimeObj.totalSpeed;

      await this._addPortionToBuffer(recordset); // Inside the function recordset is cleared

      if (this.destroyed) {
        return;
      }

      ([isCurrentTime, virtualTs] = virtualTimeObj.setNextTimeFront());

      if (!PARAMS.saveExactLastTsToRedis) {
        ee?.emit('save-last-ts', { streamId, lastTs: virtualTs });
      }

      if (isLimitExceed && this.lastRecordTs) {
        // Если превышен лимит количества записей в одном запросе, то считаем,
        // что последняя запись не может быть старше реального времени,
        // И не параноим тут типа this.nextStartTs = Math.min(this.lastRecordTs, virtualTs) если isCurrentTime === true
        this.nextStartTs = this.lastRecordTs;
      } else {
        // В случае, если лимит не превышен, чтобы не впасть в цикл пустых выборок
        this.nextStartTs = isCurrentTime
          // в режиме РЕАЛЬНОГО времени, нужно не допустить убегания nextStartTs в будущее.
          ? Math.min(endTs, virtualTs)
          // в режиме ВИРТУАЛЬНОГО времени берем nextStartTs если он больше endTs, т.к. найден в алгоритме пропуска ГЕПов.
          : Math.max(endTs, this.nextStartTs);
      }

      if (!recordsetLength) {
        await this.skipGap();
      } else {
        this.gapEdge = 0;
      }

      if (DEBUG_LNP) {
        ee?.emit('after-load-next-portion', { ...this.stat });
      }
    } catch (err: Error | any) {
      err.message += `\n${this.db.schemaAndTable}`;
      options.commonConfig.exitOnError(err);
    }
  }

  private async skipGap () {
    if (!PARAMS.skipGaps || this.virtualTimeObj.isCurrentTime) {
      this.gapEdge = 0;
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

    const nextRecordTime = await this.db.getNextRecordTs(nextStartTs);
    this.noRecordsQueryCounter = 0;
    if (!nextRecordTime) {
      return;
    }
    const nextRecordTs = this.tsFieldToMillis(nextRecordTime);
    const gap = nextRecordTs - nextStartTs;
    this.nextStartTs = nextRecordTs;
    this.gapEdge = nextRecordTs;
    if (DEBUG_LNP) {
      const payload: IEmFindNextTs = {
        streamId: this.options.streamConfig.streamId,
        o: nextStartTs,
        n: this.nextStartTs,
        gap,
      };
      this.options.commonConfig.eventEmitter?.emit('find-next-ts', payload);
    }
  }

  private async _fetchLoop () {
    clearTimeout(this._fetchLoopTimer);
    const { options: { commonConfig: { echo } } } = this;
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
        this.options.commonConfig.exitOnError(err);
        return;
      }
      this.busy = 0;
    } else {
      this.busy++;
    }

    const self = this;
    this._fetchLoopTimer = setTimeout(() => {
      self._fetchLoop();
    }, PARAMS.streamFetchIntervalSec * 1000);
  }

  private _printInfoLoop () {
    clearTimeout(this._printTimer);

    const rowsSent = `rows sent: ${bold}${padL(this.totalRowsSent || 0, 6)}${boldOff}${rs}`;
    const locked = this.locked ? `  ${bg.red}${yellow}STREAM LOCKED${rs}` : '';
    this.options.commonConfig.logger?.info(`${this.prefix} ${rowsSent} / ${this.virtualTimeObj.virtualTimeString}${locked} / ${memUsage()}`);

    const self = this;
    this._printTimer = setTimeout(() => {
      self._printInfoLoop();
    }, PARAMS.printInfoIntervalSec * 1000);
  }

  // #################################  SEND  ##################################

  private async _sendPacket (eventsPacket: TEventRecord[]): Promise<{ debugMessage: string, isError?: boolean }> {
    const { sender, sessionId, options: { commonConfig: { eventEmitter, logger }, streamConfig: { streamId } } } = this;
    return new Promise((resolve: Function) => {
      let debugMessage = '';

      // const timer = setTimeout(() => {
      //   clearTimeout(timer);
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
        if (PARAMS.saveExactLastTsToRedis) {
          const lastTs = last?.[TS_FIELD];
          if (lastTs) {
            eventEmitter.emit('save-last-ts', { streamId, lastTs });
          }
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
      // }, 5);
    });
  }

  private async _send () {
    const { recordsBuffer: rb, virtualTimeObj } = this;
    if (virtualTimeObj.locked || this.destroyed) {
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
      this.options.commonConfig.echo(`${debugMessage}\t${m}${bufferInfo}`);
    }
  }

  private async _sendLoop () {
    const self = this;
    clearTimeout(this._sendTimer);
    try {
      await this._send();
    } catch (err: Error | any) {
      return self.options.commonConfig.exitOnError(err);
    }
    this._sendTimer = setTimeout(() => {
      self._sendLoop();
    }, PARAMS.streamSendIntervalMillis);
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

  getDesiredTimeFront (timeFront: number, timeShift: number) {
    const { firstTs } = this.recordsBuffer;
    if (firstTs) {
      // Если буфер не пуст:
      // Не допускаем увеличение разницы между ts первого элемента и виртуальным временем боле, чем на maximumRunUp...
      return firstTs + PARAMS.maxRunUpFirstTsVtMillis;
    }
    // Если буфер пуст
    if (this.nextStartTs) {
      return this.nextStartTs + this.sendIntervalVirtualMillis;
    }
    return timeFront + timeShift;
  }

  getActualConfig (asString?: boolean): string | { streamConfig: IStreamConfig, senderConfig: ISenderConfig } {
    const streamConfig = cloneDeep<IStreamConfig>(this.options.streamConfig);
    const senderConfig = cloneDeep<ISenderConfig>(this.options.senderConfig);
    /**
     type: 'console' | 'tcp' | 'ws' | 'callback' | 'emitter',
     host?: string,
     port?: number
     accessPoint?: TAccessPoint
     eventCallback?: Function,
     emitSingleEvent?: boolean,
     emitId?: string,
     */

    ['prepareEvent', 'tsFieldToMillis', 'millis2dbFn'].forEach((p) => {
      delete streamConfig[p as keyof IStreamConfig];
    });
    delete senderConfig.eventCallback;
    const optionsCopy = { streamConfig, senderConfig };
    if (asString) {
      return JSON.stringify(optionsCopy, undefined, 2);
    }
    return optionsCopy;
  }

  stop (options?: { noResetVirtualTimeObj?: boolean }) {
    this.lock(true);
    clearTimeout(this._fetchLoopTimer);
    clearInterval(this._sendInterval);
    clearTimeout(this._sendTimer);
    clearTimeout(this._printTimer);

    this.recordsBuffer.flush();
    this.lastTimeRecords.flush();

    if (!options?.noResetVirtualTimeObj) {
      this.virtualTimeObj.reset();
    }

    this.lastRecordTs = 0;
    this.nextStartTs = this.virtualTimeObj.virtualStartTs;
    this.totalRowsSent = 0;
    this.isFirstLoad = true;

    this.prevLastRecordTs = 0;
    this.noRecordsQueryCounter = 0;

    this.stat = getInitStat({ vt: this.virtualTimeObj.virtualTs });
    this.initialized = false;
  }

  async destroy () {
    this.locked = true;
    this.destroyed = true;
    const { virtualTimeObj, options } = this;
    const { commonConfig, streamConfig } = options;
    const { eventEmitter: ee, echo } = commonConfig;
    if (ee) {
      Object.entries(this.eeListeners).forEach(([eventId, fn]) => {
        ee.removeListener(eventId, fn);
      });
    }
    this.prepareEvent = (dbRecord: TDbRecord) => dbRecord;
    this.tsFieldToMillis = () => 0;
    this.sender.eventCallback = () => null;

    this.stop();

    // Остановка virtualTimeObj
    virtualTimeObj.hardStop();

    const { streamId } = streamConfig;
    // Выдерживаем паузу для завершения уже запущенных циклов сброса данных
    // await sleep(PARAMS.streamFetchIntervalSec * 1000 * PARAMS.streamBufferMultiplier);
    await this.db?.destroy();

    // @ts-ignore
    this.recordsBuffer = undefined;
    // @ts-ignore
    this.lastTimeRecords = undefined;
    // @ts-ignore
    this.virtualTimeObj = undefined;
    destroySender(this.sender);
    // @ts-ignore
    this.sender = undefined;
    // @ts-ignore
    this._sendTimer = undefined;
    // @ts-ignore
    this._printTimer = undefined;
    // @ts-ignore
    this.tsFieldToMillis = undefined;
    // @ts-ignore
    this.prepareEvent = undefined;
    // @ts-ignore
    this.stat = undefined;
    echo.warn(`DESTROYED: stream [${streamId}]`);
  }
}
