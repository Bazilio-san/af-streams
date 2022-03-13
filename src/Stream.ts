/* eslint-disable no-console */
import EventEmitter from 'events';
import { DateTime } from 'luxon';
import * as cron from 'cron';
import { LastTimeRecords } from './LastTimeRecords';
import { RecordsBuffer } from './RecordsBuffer';
import { IStartTimeRedisOptions, StartTimeRedis } from './StartTimeRedis';
import { getVirtualTimeObj, IVirtualTimeObjOptions, VirtualTimeObj } from './VirtualTimeObj';
import { padL } from './utils/utils';
import getDb from './db/db';
import {
  blue, bold, boldOff, c, g, lBlue, lc, lm, m, rs,
} from './utils/color';
import {
  IDbConstructorOptions, IEcho, ILoggerEx, IRecordsComposite, ISender, ISenderConfig, ISenderConstructorOptions, IStreamConfig, TDbRecord, TEventRecord,
} from './interfaces';
import { DbMsSql } from './db/DbMsSql';
import { DbPostgres } from './db/DbPostgres';
import getSender from './sender/get-sender';

const YMDTms = 'yyyy-LL-ddTHH:mm:ss.SSS';

export interface IStreamConstructorOptions {
  streamConfig: IStreamConfig,
  senderConfig: ISenderConfig,
  serviceName: string,
  timezone: string,
  redis: {
    host: string,
    port: string | number
  },
  logger: ILoggerEx,
  echo: IEcho,
  exitOnError: Function,
  eventEmitter: EventEmitter,

  speed?: number,
  loopTimeMillis?: number,
  prepareEvent?: Function,
  testMode?: boolean,
}

export class Stream {
  public readonly bufferLookAheadMs: number;

  public lastRecordTs: number;

  public recordsBuffer: RecordsBuffer;

  public lastTimeRecords: LastTimeRecords;

  private busy: number;

  public virtualTimeObj: VirtualTimeObj;

  private sendTimer: any;

  private readonly sendInterval: number;

  private sessionId: string;

  private totalRowsSent: number;

  private readonly prepareEvent: Function;

  private isSilly: boolean;

  private isDebug: boolean;

  private readonly options: IStreamConstructorOptions;

  private db: DbMsSql | DbPostgres;

  private sender: ISender;

  private tsField: string;

  constructor (options: IStreamConstructorOptions) {
    const { streamConfig, prepareEvent } = options;
    this.options = options;
    this.prepareEvent = typeof prepareEvent === 'function' ? prepareEvent.bind(this) : (dbRecord: TDbRecord) => dbRecord;

    const { fetchIntervalSec, bufferMultiplier, src } = streamConfig;

    const { tsField, idFields } = src;
    this.bufferLookAheadMs = ((fetchIntervalSec || 10) * 1000 * (bufferMultiplier || 30));

    this.sender = {} as ISender;
    this.db = {} as DbMsSql | DbPostgres;
    this.tsField = tsField;
    this.lastRecordTs = 0;

    this.recordsBuffer = new RecordsBuffer(tsField);
    /*
     Набор хешей из идентификационных полей строк, вместе с временной меткой, равной наибольшему значению, в последнем полученном пакете.
     Служит для отбрасывания из следующей порции тех данных, что уже загружены.

     Это необходимо в случае, если для одной временной метки может быть несколько записей.
     Пример:
      tradeno    tradetime                    orderno  seccode                buysell  client
      38686190  2022-02-07 10:29:55.0000000  3420385   FSTOSS300901C00000010  B        MCU1100
      38686190  2022-02-07 10:29:55.0000000  3420375   FSTOSS300901C00000010  S        MCU57801

     Чтобы гарантированно не потерять данные, запрашиваем их с нахлестом временной метки
          WHERE [${tsField}] >= '${from}' AND [${tsField}] <= '${to}'
     Чтобы гарантированно исключить дубли, после получения данных, удаляем оттуда те, что есть в lastTimeRecords
     */
    this.lastTimeRecords = new LastTimeRecords(tsField, idFields);

    this.virtualTimeObj = {} as VirtualTimeObj;

    this.sendTimer = null;
    this.sendInterval = 10; // ms
    this.sessionId = `sid${+(new Date())}`;
    this.totalRowsSent = 0;
    this.busy = 0;
    options.eventEmitter?.on('virtual-time-loop-back', () => {
      this.lastRecordTs = 0;
      this.recordsBuffer.flush();
      this.lastTimeRecords.flush();
      this.totalRowsSent = 0;
    });
    this.isSilly = options.logger.isLevel('silly');
    this.isDebug = options.logger.isLevel('debug');
  }

  async init () {
    const {
      senderConfig, eventEmitter, echo, logger, redis, serviceName, streamConfig, speed, loopTimeMillis, exitOnError, testMode,
    } = this.options;

    const senderConstructorOptions: ISenderConstructorOptions = {
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
    const { src: { dbOptions, dbConfig }, streamId } = streamConfig;
    const startTimeRedisOptions: IStartTimeRedisOptions = {
      host,
      port,
      streamId,
      eventEmitter,
      exitOnError,
      logger,
    };
    const startTimeRedis = new StartTimeRedis(startTimeRedisOptions);
    const startTime = await startTimeRedis.getStartTimeFromRedis();

    const virtualTimeObjOptions: IVirtualTimeObjOptions = {
      startTime,
      speed,
      loopTimeMillis,
      eventEmitter,
    };
    this.virtualTimeObj = getVirtualTimeObj(virtualTimeObjOptions);

    if (!testMode) {
      const dbConstructorOptions: IDbConstructorOptions = {
        streamConfig,
        logger,
        exitOnError,
        dbOptions,
        dbConfig,
      };
      this.db = await getDb(dbConstructorOptions);
      await this._loadNextPortion();
      this._fetchLoop();
      this._printInfoLoop();
      // Дополнительный внешний цикл вызовов на случай прерывания цепочки внутренних вызовов _sendLoop()
      setInterval(() => {
        this._sendLoop().then(() => null);
      }, 1000);
    }
    return this;
  }

  // Наибольший индекс значения, меньшего, чем указанное
  findEndIndex () {
    const virtualTime = this.virtualTimeObj.getVirtualTs();
    return this.recordsBuffer.findSmallestIndex(virtualTime);
  }

  packetInfo (count: number, fromRecord?: TEventRecord | null, toRecord?: TEventRecord | null) {
    if (count && fromRecord && toRecord) {
      const HMS = 'HH:mm:ss.SSS';
      const { tsField } = this;
      const from = fromRecord[tsField];
      const to = toRecord[tsField];
      const fromLu = DateTime.fromMillis(from);
      const timeRange = `${fromLu.toFormat('LL-dd')} ${fromLu.toFormat(HMS)} - ${DateTime.fromMillis(to).toFormat(HMS)}`;
      return `r: ${padL(count, 5)} / ${timeRange} / ${padL(`${to - from} ms`, 10)}`;
    }
    return ' '.repeat(60);
  }

  prepareEventsPacket (dbRecordOrRecordset: TDbRecord[]): TEventRecord[] {
    if (!Array.isArray(dbRecordOrRecordset)) {
      if (!dbRecordOrRecordset || typeof dbRecordOrRecordset !== 'object') {
        return [];
      }
      dbRecordOrRecordset = [dbRecordOrRecordset];
    }
    return dbRecordOrRecordset.map((record) => this.prepareEvent(record));
  }

  _addPortionToBuffer (recordset: TDbRecord[]) {
    const { recordsBuffer, tsField, isSilly } = this;
    const { length: loaded = 0 } = recordset;
    let skipped = 0;
    let toUse = loaded;
    if (loaded) {
      const forBuffer = this.prepareEventsPacket(recordset);

      if (process.env.LOOP_TIME) {
        const bias = Date.now() - this.virtualTimeObj.realStartTsLoopSafe;
        forBuffer.forEach((row) => {
          row._ts = row[tsField] + bias;
          row.loopNumber = this.virtualTimeObj.loopNumber;
        });
      }

      const lastRecordTsBeforeCheck = forBuffer[forBuffer.length - 1][tsField];

      this.lastTimeRecords.subtractLastTimeRecords(forBuffer);

      toUse = forBuffer.length;
      if (toUse !== loaded) {
        skipped = loaded - toUse;
      }
      if (toUse) {
        recordsBuffer.add(forBuffer);
        this.lastRecordTs = recordsBuffer.lastTs;
        this.lastTimeRecords.fillLastTimeRecords(this.recordsBuffer.buffer);
      } else {
        this.lastRecordTs = lastRecordTsBeforeCheck + 1;
      }
    }
    if (isSilly) {
      console.log(`${lBlue}${this.options.streamConfig.streamId} ${this.virtualTimeObj.getString()
      } l/s/u: ${lm}${loaded}${blue}/${lc}${skipped}${blue}/${g}${toUse}${rs}`);
    }
  }

  async _loadNextPortion () {
    const { recordsBuffer, virtualTimeObj: vtObj, bufferLookAheadMs, lastRecordTs } = this;
    const virtualTimeObj = vtObj as VirtualTimeObj;
    const startTs = lastRecordTs ? Number(lastRecordTs) : virtualTimeObj.virtualStartTs;
    const endTs = (lastRecordTs ? virtualTimeObj.getVirtualTs() : startTs) + bufferLookAheadMs;

    if (startTs >= endTs) {
      return;
    }
    if (((recordsBuffer.getMsDistance()) > bufferLookAheadMs)) {
      return;
    }
    const from = DateTime.fromMillis(startTs).toFormat(YMDTms); // Включая
    const to = DateTime.fromMillis(endTs).toFormat(YMDTms); // Включая
    try {
      const recordset = await this.db.getPortionOfData(from, to);
      this._addPortionToBuffer(recordset);
    } catch (err: Error | any) {
      err.message += `\n${this.db.schemaAndTable}`;
      this.options.exitOnError(err);
    }
  }

  _fetchLoop () {
    const { options: { timezone, streamConfig } } = this;
    cron.job(`0/${streamConfig.fetchIntervalSec || 10} * * * * *`, async () => {
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
    }, null, true, timezone, undefined, false);
    // onComplete, start, timeZone, context, runOnInit
  }

  _printInfoLoop () {
    const { timezone, streamConfig, logger } = this.options;
    cron.job(`0/${streamConfig.printInfoIntervalSec || 30} * * * * *`, () => {
      const rowsSent = `rows sent: ${bold}${padL(this.totalRowsSent, 6)}${boldOff}${rs}`;
      logger.info(`${lBlue}${streamConfig.streamId}${rs} ${rowsSent} / ${this.virtualTimeObj.getString()}`);
    }, null, true, timezone, undefined, false);
    // onComplete, start, timeZone, context, runOnInit
  }

  async _sendPacket (eventsPacket: TEventRecord[]): Promise<{ debugMessage: string, isError?: boolean }> {
    const { sender, sessionId, isDebug, options: { eventEmitter, logger, streamConfig: { streamId } } } = this;
    return new Promise((resolve) => {
      let debugMessage = '';

      setTimeout(() => {
        if (isDebug) {
          debugMessage += `${lBlue}${streamId}${rs}`;
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
          const lastTs = last?.[this.tsField];
          if (lastTs) {
            eventEmitter.emit('save-last-ts', lastTs);
          }
          this.totalRowsSent += sendCount;
          if (isDebug) {
            debugMessage += ` SENT: ${c}${this.packetInfo(sendCount, first, last)}`;
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
    const { recordsBuffer: rb, virtualTimeObj, isDebug } = this;
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
    if (isDebug) {
      console.log(`${debugMessage}\t${m}BUFFER: ${this.packetInfo(rb.length, rb.first, rb.last)}`);
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
}
