/* eslint-disable no-await-in-loop */
// noinspection JSUnusedGlobalSymbols

import EventEmitter from 'events';
import { IStreamConstructorOptions, Stream } from '../Stream';
import { echo } from '../utils/echo-simple';
import { VirtualTimeObj, getVirtualTimeObj, IVirtualTimeObjOptions } from '../VirtualTimeObj';
import {
  ICommonConfig, IEmAfterLoadNextPortion, IEmBeforeLoadNextPortion, IOFnArgs, ISenderConfig, IStartTimeConfig, IStreamConfig, IVirtualTimeConfig, TEventRecord,
} from '../interfaces';
import { cloneDeep, intEnv } from '../utils/utils';
import { DEFAULTS, STREAM_ID_FIELD } from '../constants';
import { IRectifierOptions, Rectifier } from '../classes/applied/Rectifier';
import localEventEmitter from '../ee-scoped';
import { AlertsBuffer } from '../alerts-buffer/AlertsBuffer';
import { IAlertEmailSettings, TAlert, TMergeResult } from '../alerts-buffer/i-alert';

const findLast = require('array.prototype.findlast');

export interface IPrepareRectifierOptions {
  /**
   * Периодичность отправки ts-объектов,
   * время которых старше <virtualTs> - <accumulationTimeMillis>
   */
  sendIntervalMillis?: number,

  /**
   * Имя свойства ts-объектов, содержащих метку времени,
   * по которому нужно производить упорядочивание внутри аккумулятора.
   * Если не передано, используется "ts"
   */
  fieldNameToSort?: string,

  /**
   * Время, в пределах которого происходит аккумуляция и выпрямление событий
   */
  accumulationTimeMillis?: number,

  /**
   * Callback, которому передается массив ts-объектов, упорядоченный по возрастанию
   * значения поля fieldNameToSort (или ts)
   */
  sendFunction: (_rectifierItemsArray: TEventRecord[]) => number,
}

export interface IPrepareAlertsBufferOptions {
  /**
   * Настройки для отправки E-Mail
   */
  emailSettings: IAlertEmailSettings,

  /**
   * Функция сохранения/обновления сигналов
   */
  mergeAlerts: (alerts: TAlert[]) => Promise<TMergeResult>;

  /**
   * Функция проверки наличия сохраненного сигнала в БД
   */
  checkAlertExists: (guid: string) => Promise<boolean>,

  /**
   * Функция сохранения признаков "обработан"
   */
  mergeAlertsActions: (guids: string[], operationIds: number[]) => Promise<void>

  /**
   * Время, в течение которого храним состояние отправки/сохранения сигнала
   */
  trackAlertsStateMillis?: number, // Default = MILLIS_IN_HOUR

  /**
   * Периодичность очистки кеша состояний сигналов
   */
  removeExpiredItemsFromAlertsStatesCacheIntervalMillis?: number, // Default = 60_000

  /**
   * Период вывода сигналов из буфера на отправку по Email и сохранение в БД
   */
  flushBufferIntervalMillis?: number, // Default = 3_000

  /**
   * Массив идентификаторов операторов, для которых нужно устанавливать флажки - признаки новых сигналов
   */
  setFlagToProcForOperators?: number[],
}

const changeStreamParams = (stream: Stream, params: any) => {
  Object.entries(params).forEach(([key, value]: [string, any]) => {
    let isSetEnv = true;
    switch (key) {
      case 'STREAM_BUFFER_MULTIPLIER':
        stream.setBufferMultiplier(value);
        break;
      case 'STREAM_FETCH_INTERVAL_SEC':
        stream.setFetchIntervalSec(value);
        break;
      case 'STREAM_MAX_BUFFER_SIZE':
        stream.setMaxBufferSize(value);
        break;
      case 'STREAM_MAX_RUNUP_FIRST_TS_VT_MILLIS':
        stream.setMaxRunUpFirstTsVtMillis(value);
        break;
      case 'STREAM_PRINT_INFO_INTERVAL_SEC':
        stream.setPrintInfoIntervalSec(value);
        break;
      case 'STREAM_SEND_INTERVAL_MILLIS':
        stream.setStreamSendIntervalMillis(value);
        break;
      case 'STREAM_SKIP_GAPS':
        stream.setSkipGaps(value);
        break;
      case 'STREAM_START_BEFORE':
      case 'STREAM_START_TIME':
      case 'STREAM_USE_START_TIME_FROM_REDIS_CACHE':
        // только прописать ENV
        break;
      default:
        isSetEnv = false;
    }
    if (isSetEnv) {
      process.env[key] = String(value);
    }
  });
};

export class StreamsManager {
  public map = {} as { [streamId: string]: Stream };

  public rectifier: Rectifier = null as unknown as Rectifier;

  public virtualTimeObj: VirtualTimeObj = null as unknown as VirtualTimeObj;

  private _statLoopTimerId: any;

  private _locked: boolean = true;

  private _connectedSockets: Set<string> = new Set();

  constructor (public commonConfig: ICommonConfig) {
    const { exitOnError, logger, eventEmitter } = commonConfig;
    if (!exitOnError) {
      // eslint-disable-next-line no-console
      console.error(`No 'exitOnError' function passed to stream manager`);
      process.exit(1);
    }
    if (!commonConfig.echo) {
      exitOnError(`No 'echo' object passed to stream manager`);
    }
    if (!logger) {
      exitOnError(`No 'logger' object passed to stream manager`);
    }
    if (!eventEmitter) {
      exitOnError(`No 'eventEmitter' object passed to stream manager`);
    }
  }

  async getVirtualTimeObj (
    args: {
      commonConfig: ICommonConfig,
      virtualTimeConfig: IVirtualTimeConfig,
      startTimeConfig: IStartTimeConfig,
    },
  ): Promise<VirtualTimeObj> {
    this.commonConfig = args.commonConfig;
    this.virtualTimeObj = await getVirtualTimeObj(args);
    return this.virtualTimeObj;
  }

  async newStreams (
    optionsArray: IStreamConstructorOptions | IStreamConstructorOptions[],
    prepareRectifierOptions?: IPrepareRectifierOptions,
  ): Promise<Stream[]> {
    if (!Array.isArray(optionsArray)) {
      optionsArray = [optionsArray];
    }
    if (prepareRectifierOptions) {
      const { virtualTimeObj } = this;
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
    return optionsArray.map((options: IStreamConstructorOptions) => {
      if (prepareRectifierOptions) {
        options.senderConfig.type = 'callback';
        // Заглушка. Поскольку инициализируется Выпрямитель, сюда будет
        // прописана функция передачи событий в выпрямитель
        options.senderConfig.eventCallback = (eventRecord: TEventRecord) => this.rectifier.add(eventRecord);
      }
      const { streamId } = options.streamConfig;
      if (this.map[streamId]) {
        echo(`Stream '${streamId}' already exists`);
        return this.map[streamId];
      }
      const stream = new Stream(options);
      this.map[streamId] = stream;
      return stream;
    });
  }

  prepareAlertsBuffer (prepareAlertsBufferOptions: IPrepareAlertsBufferOptions): AlertsBuffer {
    return new AlertsBuffer({
      logger: this.commonConfig.logger,
      echo: this.commonConfig.echo,
      eventEmitter: this.commonConfig.eventEmitter,
      virtualTimeObj: this.virtualTimeObj,
      ...prepareAlertsBufferOptions,
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

  get eventEmitter (): EventEmitter {
    return this.commonConfig.eventEmitter;
  }

  changeStreamsParams (data: any) {
    const { params } = data;
    if (!params || typeof params !== 'object') {
      return;
    }
    const { virtualTimeObj } = this;
    if (!virtualTimeObj) {
      return;
    }

    Object.entries(params).forEach(([key, value]: [string, any]) => {
      let isSetEnv = true;
      switch (key) {
        case 'STREAM_LOOP_TIME_MILLIS':
          virtualTimeObj.setLoopTimeMillis(value);
          break;
        case 'STREAM_SPEED':
          virtualTimeObj.setSpeed(value);
          break;
        case 'STREAM_SPEED_CALC_INTERVAL_SEC':
          virtualTimeObj.setSpeedCalcIntervalSec(value);
          break;
        case 'STREAM_TIME_FRONT_UPDATE_INTERVAL_MILLIS':
          virtualTimeObj.setTimeFrontUpdateIntervalMillis(value);
          break;
        default:
          isSetEnv = false;
      }
      if (isSetEnv) {
        process.env[key] = String(value);
      }
    });

    let { streamIds } = data;
    if (!Array.isArray(streamIds)) {
      ({ streamIds } = this);
    }
    streamIds.forEach((streamId: string) => {
      if (this.has(streamId)) {
        const stream = this.getStream(streamId);
        if (stream) {
          changeStreamParams(stream, params);
        }
      }
    });
  }

  getConfigs (): { virtualTimeConfig: IVirtualTimeObjOptions, streamConfigs: { streamConfig: IStreamConfig, senderConfig: ISenderConfig }[] } {
    const streamConfigs = this.streams.map((stream) => (stream.getActualConfig() as { streamConfig: IStreamConfig, senderConfig: ISenderConfig }));
    const virtualTimeConfig = cloneDeep<IVirtualTimeObjOptions>(this.virtualTimeObj.options);
    // @ts-ignore
    delete virtualTimeConfig.commonConfig;
    return { virtualTimeConfig, streamConfigs };
  }

  pause () {
    this._locked = true;
    this.stopIoStatistics();
    this.streams.forEach((stream) => {
      stream.lock(true);
    });
  }

  resume () {
    this.streams.forEach((stream) => {
      stream.unLock(true);
    });
    this._locked = false;
    this.startIoStatistics();
  }

  stop () {
    this._locked = true;
    this.stopIoStatistics();
    this.streams.forEach((stream) => {
      stream.stop();
    });
  }

  async start (): Promise<Stream[]> {
    const streams = await Promise.all(this.streams.map((stream) => stream.start()));
    this._locked = false;
    this.startIoStatistics();
    return streams;
  }

  async restart () {
    this.stop();
    return this.start();
  }

  collectAndEmitStatistics () {
    /*
    виртуальное время
    диапазон запроса потока 1
    диапазон запроса потока 2

    ширина окна выпрямителя
    мин-макс события в выпрямителе
     - первого потока
     - второго потока
    мин-макс события в буфере 1 потока + количество
    мин-макс события в буфере 2 потока + количество
    */
    const { rectifier, virtualTimeObj, streams } = this;
    const { accumulator } = rectifier;
    const { length } = accumulator;

    const data = {
      vt: virtualTimeObj.virtualTs,
      isCurrentTime: virtualTimeObj.isCurrentTime,
      rectifier: {
        widthMillis: rectifier.options.accumulationTimeMillis,
        rectifierItemsCount: length,
      },
      streams: streams.map((stream) => {
        const { options: { streamConfig: { streamId } }, recordsBuffer: rb } = stream;
        return {
          buf: {
            firstTs: rb.firstTs,
            lastTs: rb.lastTs,
            len: rb.length,
          },
          rec: {
            firstTs: length && accumulator.find((d: TEventRecord) => d[STREAM_ID_FIELD] === streamId)?.tradeTime,
            lastTs: length && findLast(accumulator, (d: TEventRecord) => d[STREAM_ID_FIELD] === streamId)?.tradeTime,
            len: length && accumulator.reduce((accum, d) => accum + (d[STREAM_ID_FIELD] === streamId ? 1 : 0), 0),
          },
        };
      }),
    };
    localEventEmitter.emit('time-stat', data);
  }

  streamsSocketIO ({ socket }: IOFnArgs) {
    const socketId = socket.id;

    this._connectedSockets.add(socketId);
    socket.on('disconnect', () => {
      this._connectedSockets.delete(socketId);
      if (!this._connectedSockets.size) {
        this.stopIoStatistics();
      }
    });

    this.startIoStatistics();

    localEventEmitter.on('before-lnp', (data: IEmBeforeLoadNextPortion) => {
      const { heapUsed, rss } = process.memoryUsage();
      socket.emit('before-lnp', { ...data, heapUsed, rss });
    });

    localEventEmitter.on('after-lnp', (data: IEmAfterLoadNextPortion) => {
      const { heapUsed, rss } = process.memoryUsage();
      socket.emit('after-lnp', { ...data, heapUsed, rss });
    });

    localEventEmitter.on('time-stat', (data: any) => {
      socket.emit('time-stat', data);
    });

    socket.on('pause', (...args) => {
      this.pause();
      socket.applyFn(args, true);
    });

    socket.on('resume', (...args) => {
      this.resume();
      socket.applyFn(args, true);
    });

    socket.on('stop', (...args) => {
      this.stop();
      socket.applyFn(args, true);
    });

    socket.on('start', async (...args) => {
      await this.start();
      socket.applyFn(args, true);
    });

    socket.on('restart', async (...args) => {
      await this.restart();
      socket.applyFn(args, true);
    });

    socket.on('change-streams-params', (data, ...args) => {
      this.changeStreamsParams(data);
      const actualConfigs = this.getConfigs();
      if (!socket.applyFn(args, { actualConfigs })) {
        socket.emit('actual-streams-configs', { actualConfigs });
      }
    });
  }

  startIoStatistics () {
    if (this._locked || !this._connectedSockets.size) {
      return;
    }
    const statLoop = () => {
      clearTimeout(this._statLoopTimerId);
      if (this._locked || !this._connectedSockets.size) {
        return;
      }
      this.collectAndEmitStatistics();
      this._statLoopTimerId = setTimeout(() => {
        statLoop();
      }, 200);
    };
    statLoop();
  }

  stopIoStatistics () {
    clearTimeout(this._statLoopTimerId);
  }
}
