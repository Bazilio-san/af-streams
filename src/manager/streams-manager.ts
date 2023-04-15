/* eslint-disable no-await-in-loop */
// noinspection JSUnusedGlobalSymbols

import EventEmitter from 'events';
import { echo as echoSimple } from 'af-echo-ts';
import { Stream } from '../Stream';
import { VirtualTimeObj, getVirtualTimeObj, IVirtualTimeObjOptions } from '../VirtualTimeObj';
import {
  ICommonConfig, IEcho, ILoggerEx, IOFnArgs, ISenderConfig, IStartTimeConfig, IStreamConfig, IVirtualTimeConfig, TEventRecord,
} from '../interfaces';
import { cloneDeep, intEnv, timeParamRE } from '../utils/utils';
import { DEFAULTS, STREAMS_ENV, reloadStreamsEnv, STREAM_ID_FIELD } from '../constants';
import { IRectifierOptions, Rectifier } from '../classes/applied/Rectifier';
import localEventEmitter from '../ee-scoped';
import { AlertsBuffer } from '../alerts-buffer/AlertsBuffer';
import { toUTC_ } from '../utils/date-utils';
import { IPrepareAlertsBufferOptions, IPrepareRectifierOptions, IPrepareStreamOptions, ISmStatisticsData } from './i';
import { changeSmParams } from './change-params';

const findLast = require('array.prototype.findlast');

const STATISTICS_SEND_INTERVAL = { SLOW: 1000, QUICK: 100 };

export class StreamsManager {
  public map: { [streamId: string]: Stream };

  public rectifier: Rectifier = null as unknown as Rectifier;

  public virtualTimeObj: VirtualTimeObj = null as unknown as VirtualTimeObj;

  public alertsBuffer: AlertsBuffer = null as unknown as AlertsBuffer;

  public eventEmitter: EventEmitter;

  public logger: ILoggerEx;

  public echo: IEcho;

  private _statLoopTimerId: any;

  private _locked: boolean = true;

  private _connectedSockets: Set<string>;

  private statisticsSendIntervalMillis: number = STATISTICS_SEND_INTERVAL.QUICK;

  constructor (public commonConfig: ICommonConfig) {
    this.map = {};
    this._locked = true;
    this._connectedSockets = new Set();
    this.checkCommonConfig(true);
    this.eventEmitter = this.commonConfig.eventEmitter;
    this.logger = this.commonConfig.logger;
    this.echo = this.commonConfig.echo;
  }

  checkCommonConfig (isInit: boolean = false) {
    const t = `${isInit ? 'passed to' : 'found in'} stream manager`;
    const { exitOnError, logger, echo: ech, eventEmitter } = this.commonConfig || {};
    if (!exitOnError) {
      // eslint-disable-next-line no-console
      console.error(`No 'exitOnError' function ${t}`);
      process.exit(1);
    }
    if (!ech) {
      exitOnError(`No 'echo' object ${t}`);
    }
    if (!logger) {
      exitOnError(`No 'logger' object ${t}`);
    }
    if (!eventEmitter) {
      exitOnError(`No 'eventEmitter' object ${t}`);
    }
  }

  checkVirtualTimeObject () {
    if (!this.virtualTimeObj) {
      this.commonConfig.exitOnError(`No 'virtualTimeObj' object found in stream manager`);
    }
  }

  async prepareVirtualTimeObj (
    args: {
      virtualTimeConfig: IVirtualTimeConfig,
      startTimeConfig: IStartTimeConfig,
    },
  ): Promise<VirtualTimeObj> {
    this.checkCommonConfig();
    const { commonConfig } = this;
    this.virtualTimeObj = await getVirtualTimeObj({ commonConfig, ...args });
    return this.virtualTimeObj;
  }

  prepareAlertsBuffer (prepareAlertsBufferOptions: IPrepareAlertsBufferOptions): AlertsBuffer {
    this.checkCommonConfig();
    const { logger, echo, eventEmitter, virtualTimeObj } = this;
    this.alertsBuffer = new AlertsBuffer({ logger, echo, eventEmitter, virtualTimeObj, ...prepareAlertsBufferOptions });
    return this.alertsBuffer;
  }

  async prepareStreams (
    optionsArray: IPrepareStreamOptions | IPrepareStreamOptions[],
    prepareRectifierOptions?: IPrepareRectifierOptions,
  ): Promise<Stream[]> {
    this.checkCommonConfig();
    this.checkVirtualTimeObject();
    const { commonConfig, virtualTimeObj } = this;
    if (!Array.isArray(optionsArray)) {
      optionsArray = [optionsArray];
    }
    if (prepareRectifierOptions) {
      const { sendIntervalMillis, fieldNameToSort, accumulationTimeMillis, sendFunction } = prepareRectifierOptions;
      const rectifierOptions: IRectifierOptions = {
        virtualTimeObj,
        accumulationTimeMillis: accumulationTimeMillis || intEnv('RECTIFIER_ACCUMULATION_TIME_MILLIS', DEFAULTS.RECTIFIER_ACCUMULATION_TIME_MILLIS),
        sendIntervalMillis: sendIntervalMillis || intEnv('RECTIFIER_SEND_INTERVAL_MILLIS', DEFAULTS.RECTIFIER_SEND_INTERVAL_MILLIS),
        fieldNameToSort: fieldNameToSort || DEFAULTS.RECTIFIER_FIELD_NAME_TO_SORT,
        sendFunction,
      };
      // Подготавливаем "Выпрямитель". Он будет получать все события потоков
      this.rectifier = new Rectifier(rectifierOptions);
    }
    return optionsArray.map((options: IPrepareStreamOptions) => {
      if (prepareRectifierOptions) {
        options.senderConfig.type = 'callback';
        // Заглушка. Поскольку инициализируется Выпрямитель, сюда будет
        // прописана функция передачи событий в выпрямитель
        options.senderConfig.eventCallback = (eventRecord: TEventRecord) => this.rectifier.add(eventRecord);
      }
      const { streamId } = options.streamConfig;
      if (this.map[streamId]) {
        echoSimple(`Stream '${streamId}' already exists`);
        return this.map[streamId];
      }
      const stream = new Stream({ ...options, commonConfig, virtualTimeObj });
      this.map[streamId] = stream;
      return stream;
    });
  }

  async initStreams (): Promise<Stream[]> {
    const streams: Stream[] = [];

    for (let i = 0; i < this.streams.length; i++) {
      const stream = await this.streams[i].init();
      streams.push(stream);
    }
    return streams;
  }

  get streamIds (): string[] {
    return Object.keys(this.map);
  }

  get streams (): Stream[] {
    return Object.values(this.map);
  }

  has (streamId: string): boolean {
    return Boolean(this.map[streamId]);
  }

  getStream (streamId: string): Stream | undefined {
    return this.map[streamId];
  }

  changeParams (data: any) {
    const { virtualTimeObj, rectifier, streams } = this;
    changeSmParams(virtualTimeObj, rectifier, streams, data);
  }

  getConfigs (): { virtualTimeConfig: IVirtualTimeObjOptions, streamConfigs: { streamConfig: IStreamConfig, senderConfig: ISenderConfig }[] } {
    const streamConfigs = this.streams.map((stream) => (stream.getActualConfig() as { streamConfig: IStreamConfig, senderConfig: ISenderConfig }));
    const virtualTimeConfig = cloneDeep<IVirtualTimeObjOptions>(this.virtualTimeObj.options);
    // @ts-ignore
    delete virtualTimeConfig.commonConfig;
    return { virtualTimeConfig, streamConfigs };
  }

  getConfigsParams (): { [paramName: string]: string | number | boolean | undefined } {
    let streamStartBefore: string | undefined = process.env.STREAM_START_BEFORE;
    if (!timeParamRE.test(String(streamStartBefore || ''))) {
      streamStartBefore = undefined;
    }

    return {
      isStopped: this.isStopped(),
      isSuspended: this._locked,
      startFromLastStop: this.virtualTimeObj?.options.startTimeRedis.options.startTimeConfig.useStartTimeFromRedisCache,
      streamStartTime: toUTC_(this.virtualTimeObj?.options.startTimeMillis || 0),
      streamStartBefore,
      speed: this.virtualTimeObj?.speed,
      emailSendRule: STREAMS_ENV.EMAIL_SEND_RULE,
      processHistoricalAlerts: STREAMS_ENV.PROCESS_HISTORICAL_ALERTS,

      fetchIntervalSec: STREAMS_ENV.FETCH_INTERVAL_SEC,
      bufferMultiplier: STREAMS_ENV.BUFFER_MULTIPLIER,
      streamSendIntervalMillis: STREAMS_ENV.STREAM_SEND_INTERVAL_MILLIS,
      timeFrontUpdateIntervalMillis: STREAMS_ENV.TIME_FRONT_UPDATE_INTERVAL_MILLIS,
      rectifierSendIntervalMillis: STREAMS_ENV.RECTIFIER_SEND_INTERVAL_MILLIS,
      rectifierAccumulationTimeMillis: STREAMS_ENV.RECTIFIER_ACCUMULATION_TIME_MILLIS,
      maxRunUp: STREAMS_ENV.MAX_RUNUP_FIRST_TS_VT_MILLIS,

      loopTimeMillis: STREAMS_ENV.LOOP_TIME_MILLIS,
      maxBufferSize: STREAMS_ENV.MAX_BUFFER_SIZE,
      printInfoIntervalSec: STREAMS_ENV.PRINT_INFO_INTERVAL_SEC,
      skipGaps: STREAMS_ENV.SKIP_GAPS,
    };
  }

  suspend () {
    this._locked = true;
    this.slowDownStatistics();
    this.streams.forEach((stream) => {
      stream.lock(true);
    });
    this.logger.info(`Streams manager suspended`);
  }

  continue () {
    this.streams.forEach((stream) => {
      stream.unLock(true);
    });
    this._locked = false;
    this.startIO(true);
    this.logger.info(`Streams manager continued`);
  }

  async start (): Promise<Stream[]> {
    reloadStreamsEnv();
    await this.virtualTimeObj?.resetWithStartTime();
    this.virtualTimeObj?.startUpInfo();
    const streams = await Promise.all(this.streams.map((stream) => stream.start()));
    this._locked = false;
    this.startIO(true);
    this.logger.info(`Streams manager started`);
    return streams;
  }

  collectAndEmitStatistics () {
    const isSuspended = this._locked;
    const isStopped = this.isStopped();
    const { heapUsed, rss } = process.memoryUsage();
    let data: ISmStatisticsData;
    if (isStopped) {
      data = { isSuspended, isStopped, heapUsed, rss };
    } else {
      const { rectifier, virtualTimeObj, streams } = this;
      const { virtualTs: vt, isCurrentTime, lastSpeed, totalSpeed } = virtualTimeObj || {};
      const { accumulator } = rectifier || {};
      const { length = 0 } = accumulator || {};
      data = {
        isSuspended,
        isStopped,
        heapUsed,
        rss,
        vt,
        isCurrentTime,
        lastSpeed,
        totalSpeed,
        rectifier: {
          widthMillis: rectifier?.options.accumulationTimeMillis || 0,
          rectifierItemsCount: length,
        },
        streams: streams.map((stream) => {
          const { options: { streamConfig: { streamId } }, recordsBuffer: rb, stat } = stream;
          const { recordsetLength, isLimitExceed, queryDurationMillis } = stat || {};
          return {
            recordsetLength,
            isLimitExceed,
            queryDurationMillis,
            streamId,
            buf: {
              firstTs: rb?.firstTs,
              lastTs: rb?.lastTs,
              len: rb?.length,
            },
            rec: {
              firstTs: length && accumulator.find((d: TEventRecord) => d[STREAM_ID_FIELD] === streamId)?.tradeTime,
              lastTs: length && findLast(accumulator, (d: TEventRecord) => d[STREAM_ID_FIELD] === streamId)?.tradeTime,
              len: length && accumulator.reduce((accum, d) => accum + (d[STREAM_ID_FIELD] === streamId ? 1 : 0), 0),
            },
          };
        }),
      };
    }
    localEventEmitter.emit('sm-statistics', data);
  }

  streamsSocketIO ({ socket }: IOFnArgs) {
    const socketId = socket.id;

    this._connectedSockets.add(socketId);

    const listeners: { [eventId: string]: (...args: any[]) => any } = {};
    listeners['sm-statistics'] = (data: any) => {
      socket.volatile.emit('sm-statistics', data);
    };

    Object.entries(listeners).forEach(([eventId, fn]) => {
      localEventEmitter.on(eventId, fn);
    });
    this.startIO();

    socket.on('disconnect', () => {
      echoSimple.warn(`SOCKET DISCONNECTED: ${socketId}`);
      this._connectedSockets.delete(socketId);
      if (!this._connectedSockets.size) {
        this.stopIO();
      }
      Object.entries(listeners).forEach(([eventId, fn]) => {
        localEventEmitter.removeListener(eventId, fn);
      });
    });

    socket.on('sm-suspend', (...args) => {
      this.suspend();
      socket.applyFn(args, this._locked);
    });

    socket.on('sm-continue', (...args) => {
      this.continue();
      socket.applyFn(args, this._locked);
    });
  }

  isLocked (): boolean {
    return this._locked;
  }

  stopIO () {
    clearTimeout(this._statLoopTimerId);
  }

  startIO (speedUp: boolean = false) {
    if (speedUp) {
      this.speedUpStatistics();
    }
    if (!this._connectedSockets.size) {
      return;
    }
    const statLoop = () => {
      this.stopIO();
      if (!this._connectedSockets.size) {
        return;
      }
      this.collectAndEmitStatistics();
      this._statLoopTimerId = setTimeout(() => {
        statLoop();
      }, this.statisticsSendIntervalMillis);
    };
    statLoop();
  }

  slowDownStatistics () {
    this.statisticsSendIntervalMillis = STATISTICS_SEND_INTERVAL.SLOW;
  }

  speedUpStatistics () {
    this.statisticsSendIntervalMillis = STATISTICS_SEND_INTERVAL.QUICK;
  }

  isStopped () {
    return this._locked
      && (
        !this.alertsBuffer
        || !Object.keys(this.map).length
      );
  }

  async destroy () {
    this._locked = true;
    this.slowDownStatistics();
    await Promise.all(this.streams.map((stream) => stream.destroy()));
    this.map = {};
    this.rectifier?.destroy();
    this.rectifier = null as unknown as Rectifier;
    this.virtualTimeObj?.lock();
    this.virtualTimeObj?.reset();
    this.alertsBuffer?.destroy();
    this.alertsBuffer = null as unknown as AlertsBuffer;
    this.logger.warn(`DESTROYED: [StreamsManager]`);
  }
}
