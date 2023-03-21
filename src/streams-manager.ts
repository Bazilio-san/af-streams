import { IStreamConstructorOptions, Stream } from './Stream';
import { echo } from './utils/echo-simple';
import { VirtualTimeObj } from './VirtualTimeObj';
import { TEventRecord } from './interfaces';
import { intEnv } from './utils/utils';
import { DEFAULTS } from './constants';
import { IRectifierOptions, Rectifier } from './classes/Rectifier';

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
  sendFunction: (rectifierItemsArray: TEventRecord[]) => number,
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
      case 'STREAM_LOOP_TIME':
        stream.setLoopTime(value);
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
      case 'STREAM_SPEED':
        stream.setSpeed(value);
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

  new (
    optionsArray: IStreamConstructorOptions | IStreamConstructorOptions[],
    prepareRectifierOptions?: IPrepareRectifierOptions,
  ): Stream[] {
    if (!Array.isArray(optionsArray)) {
      optionsArray = [optionsArray];
    }
    const streams = optionsArray.map((options: IStreamConstructorOptions) => {
      const { streamId } = options.streamConfig;
      if (this.map[streamId]) {
        echo(`Stream '${streamId}' already exists`);
        return this.map[streamId];
      }
      const stream = new Stream(options);
      this.map[streamId] = stream;
      return stream;
    });

    if (prepareRectifierOptions) {
      const { virtualTimeObj } = streams[0];
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
      streams.forEach((stream) => {
        stream.setEventCallback = (eventRecord: TEventRecord) => this.rectifier.add(eventRecord);
      });
    }

    return streams;
  }

  async initStreams () {
    return Promise.all(this.streams.map((stream) => stream.init()));
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

  get virtualTimeObj (): VirtualTimeObj {
    return Object.values(this.map)[0]?.virtualTimeObj;
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
    let v = params.STREAM_SPEED_CALC_INTERVAL_SEC;
    if (v) {
      process.env.STREAM_SPEED_CALC_INTERVAL_SEC = String(v);
      virtualTimeObj.setSpeedCalcIntervalSec(v);
    }
    v = params.STREAM_TIME_FRONT_UPDATE_INTERVAL_MILLIS;
    if (v) {
      process.env.STREAM_TIME_FRONT_UPDATE_INTERVAL_MILLIS = String(v);
      virtualTimeObj.setTimeFrontUpdateIntervalMillis(v);
    }
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

  getConfigs (): IStreamConstructorOptions[] {
    return this.streams.map((stream) => (stream.getActualConfig() as IStreamConstructorOptions));
  }

  pause () {
    this.streams.forEach((stream) => {
      stream.lock(true);
    });
  }

  resume () {
    this.streams.forEach((stream) => {
      stream.unLock(true);
    });
  }

  stop () {
    this.streams.forEach((stream) => {
      stream.stop();
    });
  }

  async start () {
    return Promise.all(this.streams.map((stream) => stream.start()));
  }

  async restart () {
    this.stop();
    return this.start();
  }
}

export const streamsManager = new StreamsManager();
