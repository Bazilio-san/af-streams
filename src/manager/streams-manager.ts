/* eslint-disable no-await-in-loop */
// noinspection JSUnusedGlobalSymbols

import EventEmitter from 'events';
import { echo as echoSimple } from 'af-echo-ts';
import { green, cyan, lBlue, magenta, yellow, bg, red } from 'af-color';
import { Stream } from '../Stream';
import { VirtualTimeObj, getVirtualTimeObj } from '../VirtualTimeObj';
import { ICommonConfig, IEcho, ILoggerEx, IOFnArgs, IRedisConfig, TEventRecord } from '../interfaces';
import { PARAMS, changeParams, IStreamsParamsConfig, applyParamsConfigOnce } from '../params';
import { STREAM_ID_FIELD } from '../constants';
import { Rectifier } from '../classes/applied/Rectifier';
import localEventEmitter from '../ee-scoped';
import { AlertsBuffer } from '../alerts-buffer/AlertsBuffer';
import { IPrepareAlertsBufferOptions, IPrepareRectifierOptions, IPrepareStreamOptions, ISmStatisticsData } from './i';
import { getStartTimeRedis } from '../StartTimeRedis';

const findLast = require('array.prototype.findlast');

const streamsColors = [lBlue, magenta, cyan, yellow, green];

const STATISTICS_SEND_INTERVAL = { SLOW: 1000, QUICK: 100 };

const PFX = '[STREAMS MANAGER]: ';

export class StreamsManager {
  public map: { [streamId: string]: Stream };

  public rectifier: Rectifier = null as unknown as Rectifier;

  public virtualTimeObj: VirtualTimeObj = null as unknown as VirtualTimeObj;

  public alertsBuffer: AlertsBuffer = null as unknown as AlertsBuffer;

  public eventEmitter: EventEmitter;

  public logger: ILoggerEx;

  public echo: IEcho;

  public isInitProcess: boolean = false;

  public isShutdownProcess: boolean = false;

  private _statLoopTimerId: any;

  private _locked: boolean = true;

  private _connectedSockets: Set<string>;

  private statisticsSendIntervalMillis: number = STATISTICS_SEND_INTERVAL.QUICK;

  private redisConfig: IRedisConfig | undefined;

  constructor (public commonConfig: ICommonConfig, streamsParamsConfig?: IStreamsParamsConfig) {
    const { echo, logger, eventEmitter } = commonConfig;
    this.map = {};
    this._locked = true;
    this._connectedSockets = new Set();
    this.checkCommonConfig(true);
    this.eventEmitter = eventEmitter;
    this.logger = logger;
    this.echo = echo;
    if (streamsParamsConfig) {
      applyParamsConfigOnce(streamsParamsConfig);
    }
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

  async prepareVirtualTimeObj (redisConfig?: IRedisConfig): Promise<VirtualTimeObj> {
    this.checkCommonConfig();
    this.redisConfig = redisConfig;
    const { commonConfig } = this;
    await getStartTimeRedis({ commonConfig, redisConfig }).defineStartTime();
    this.virtualTimeObj = await getVirtualTimeObj(commonConfig);
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
      // Подготавливаем "Выпрямитель". Он будет получать все события потоков
      this.rectifier = new Rectifier({ ...prepareRectifierOptions, virtualTimeObj });
    }
    return optionsArray.map((options: IPrepareStreamOptions, index) => {
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
      stream.color = streamsColors[index] || '';
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

  async changeParams (streamsParamsConfig: IStreamsParamsConfig) {
    const { commonConfig, redisConfig, rectifier } = this;
    await changeParams(streamsParamsConfig, rectifier, getStartTimeRedis({ commonConfig, redisConfig }));
  }

  getConfigsParams (removeTimeStartStopMillis?: boolean): IStreamsParamsConfig {
    const params = {
      ...PARAMS,
      isStopped: this.isStopped(),
      isSuspended: this._locked,
      isInitProcess: this.isInitProcess,
      isShutdownProcess: this.isShutdownProcess,
    } as IStreamsParamsConfig;
    delete params._timeStartBeforeUnit;
    if (removeTimeStartStopMillis) {
      delete params.timeStartMillis;
      delete params.timeStopMillis;
      delete params.timeStartBeforeMillis;
    }
    return params;
  }

  suspend () {
    this._locked = true;
    this.slowDownStatistics();
    this.streams.forEach((stream) => {
      stream.lock(true);
    });
    localEventEmitter.emit('sm-suspended');
    this.logger.info(`\n${PFX}${bg.yellow}STREAMS SUSPENDED${bg.def}`);
  }

  continue () {
    this.streams.forEach((stream) => {
      stream.unLock(true);
    });
    this._locked = false;
    this.startIO(true);
    localEventEmitter.emit('sm-continued');
    this.logger.info(`${PFX}${bg.green}STREAMS CONTINUED${bg.def}`);
  }

  async start (): Promise<Stream[]> {
    this.isShutdownProcess = false;
    if (!this.virtualTimeObj) {
      const err = `Missing StreamsManager.virtualTimeObj`;
      localEventEmitter.emit('sm-error', `Missing StreamsManager.virtualTimeObj`);
      this.logger.error(err);
      return [];
    }
    await this.virtualTimeObj.start();
    const streams = await Promise.all(this.streams.map((stream) => stream.start()));
    this._locked = false;
    this.startIO(true);
    localEventEmitter.emit('sm-started');
    this.logger.info(`${PFX}${bg.green}STREAMS STARTED${bg.def}`);
    return streams;
  }

  collectAndEmitStatistics () {
    const isSuspended = this._locked;
    const isStopped = this.isStopped();
    const { heapUsed, rss } = process.memoryUsage();
    let data: ISmStatisticsData;
    if (isStopped) {
      data = { isSuspended, isStopped, heapUsed, rss, isInitProcess: this.isInitProcess, isShutdownProcess: this.isShutdownProcess };
    } else {
      const { rectifier, virtualTimeObj, streams, alertsBuffer, isInitProcess, isShutdownProcess } = this;
      const { virtualTs: vt, isCurrentTime, lastSpeed, totalSpeed } = virtualTimeObj || {};
      const { accumulator } = rectifier || {};
      const { length = 0 } = accumulator || {};
      data = {
        isSuspended,
        isStopped,
        isInitProcess,
        isShutdownProcess,
        heapUsed,
        rss,
        vt,
        isCurrentTime,
        lastSpeed,
        totalSpeed,
        alertsBufferLength: alertsBuffer.length,
        rectifier: {
          widthMillis: PARAMS.rectifierAccumulationTimeMillis,
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
    listeners['sm-statistics'] = (data: any) => socket.volatile.emit('sm-statistics', data);
    listeners['sm-error'] = (errMessage: string) => socket.volatile.emit('sm-error', errMessage);

    Object.entries(listeners).forEach(([eventId, fn]) => {
      localEventEmitter.on(eventId, fn);
    });
    this.startIO();

    socket.on('disconnect', () => {
      socket.removeAllListeners();
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

  async stopAndDestroy (processRemainingAlerts?: boolean): Promise<boolean> {
    this._locked = true;
    try {
      this.slowDownStatistics();
      await Promise.all(this.streams.map((stream) => stream.destroy()));
      this.map = {};
      if (this.rectifier) {
        this.rectifier.destroy();
        this.rectifier = null as unknown as Rectifier;
      }
      const { virtualTimeObj, alertsBuffer } = this;
      if (virtualTimeObj) {
        virtualTimeObj.lock();
        virtualTimeObj.reset();
      }
      if (alertsBuffer) {
        alertsBuffer.lock();
        if (processRemainingAlerts) {
          const alertsProcessed = await alertsBuffer.flushBuffer(true);
          if (alertsProcessed) {
            this.echo(`Processed: ${alertsProcessed} remaining alerts`);
          }
        }
        alertsBuffer.destroy();
        this.alertsBuffer = null as unknown as AlertsBuffer;
      }
      this.isInitProcess = false;
      this.echo.warn(`DESTROYED: [StreamsManager]`);
      this.logger.info(`\n${PFX}${bg.yellow}STREAMS ${red}STOPPED${bg.def}`);
      return true;
    } catch (err) {
      this.logger.error(err);
      return false;
    }
  }
}
