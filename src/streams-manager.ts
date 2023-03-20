import { IStreamConstructorOptions, Stream } from './Stream';
import { echo } from './utils/echo-simple';
import { VirtualTimeObj } from './VirtualTimeObj';

export const streamsManager = {
  map: {} as { [streamId: string]: Stream },

  new (options: IStreamConstructorOptions): Stream {
    const { streamId } = options.streamConfig;
    if (this.map[streamId]) {
      echo(`Stream '${streamId}' already exists`);
      return this.map[streamId];
    }
    const stream = new Stream(options);
    this.map[streamId] = stream;
    return stream;
  },

  list (): Stream[] {
    return Object.values(this.map);
  },

  has (streamId: string): boolean {
    return Boolean(this.map[streamId]);
  },

  getStream (streamId: string): Stream | undefined {
    return this.map[streamId];
  },

  get virtualTimeObj (): VirtualTimeObj {
    return Object.values(this.map)[0]?.virtualTimeObj;
  },

  changeStreamParams (stream: Stream, params: any) {
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
  },

  changeStreamsParams (data: any) {
    const { streamIds, params } = data;
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
    if (!Array.isArray(streamIds)) {
      return;
    }
    streamIds.forEach((streamId) => {
      if (this.has(streamId)) {
        const stream = this.getStream(streamId);
        if (stream) {
          this.changeStreamParams(stream, params);
        }
      }
    });
  },
};
