import { DateTime } from 'luxon';
import { Stream } from '../Stream';
import { timeParamRE } from '../utils/utils';
import { EMailSendRule, reloadStreamsEnv } from '../constants';
import { VirtualTimeObj } from '../VirtualTimeObj';
import { Rectifier } from '../classes/applied/Rectifier';

const changeStreamParams = (stream: Stream, params: any) => {
  Object.entries(params).forEach(([key, value]: [string, any]) => {
    switch (key) {
      case 'bufferMultiplier': {
        if (typeof value === 'number') {
          stream.setBufferMultiplier(value);
        }
        break;
      }
      case 'fetchIntervalSec': {
        if (typeof value === 'number') {
          stream.setFetchIntervalSec(value);
        }
        break;
      }
      case 'maxBufferSize': {
        if (typeof value === 'number') {
          stream.setMaxBufferSize(value);
        }
        break;
      }
      case 'maxRunUp': {
        if (typeof value === 'number') {
          stream.setMaxRunUpFirstTsVtMillis(value);
        }
        break;
      }
      case 'printInfoIntervalSec': {
        if (typeof value === 'number') {
          stream.setPrintInfoIntervalSec(value);
        }
        break;
      }
      case 'skipGaps':
        if (typeof value === 'boolean') {
          stream.setSkipGaps(value);
        }
        break;
      case 'streamSendIntervalMillis': {
        if (typeof value === 'number') {
          stream.setStreamSendIntervalMillis(value);
        }
        break;
      }
    }
  });
};

export const changeSmParams = (virtualTimeObj: VirtualTimeObj, rectifier: Rectifier, streams: Stream[], data: any) => {
  const { params, env } = data || {};
  if (typeof env === 'object') {
    Object.entries(env).forEach(([envName, envValue]) => {
      process.env[envName] = String(envValue);
    });
  }
  if (typeof params !== 'object') {
    return;
  }
  if (!virtualTimeObj) {
    return;
  }

  Object.entries(params).forEach(([key, value]: [string, any]) => {
    switch (key) {
      case 'bufferMultiplier': {
        if (typeof value === 'number') {
          params.value = Math.max(1, value);
          process.env.STREAM_BUFFER_MULTIPLIER = String(params.value);
        }
        break;
      }
      case 'emailSendRule': {
        if (Object.values(EMailSendRule).includes(value)) {
          process.env.EMAIL_SEND_RULE = value;
        }
        break;
      }
      case 'fetchIntervalSec': {
        if (typeof value === 'number') {
          params.value = Math.max(1, Math.ceil(value));
          process.env.STREAM_FETCH_INTERVAL_SEC = String(params.value);
        }
        break;
      }
      case 'loopTimeMillis':
        if (typeof value === 'number') {
          virtualTimeObj.setLoopTimeMillis(value);
          process.env.STREAM_LOOP_TIME_MILLIS = String(value);
        }
        break;
      case 'maxBufferSize': {
        if (typeof value === 'number') {
          params.value = Math.max(1, Math.ceil(value));
          process.env.STREAM_MAX_BUFFER_SIZE = String(params.value);
        }
        break;
      }
      case 'maxRunUp': {
        if (typeof value === 'number') {
          params.value = Math.max(1, Math.ceil(value));
          process.env.STREAM_MAX_RUNUP_FIRST_TS_VT_MILLIS = String(params.value);
        }
        break;
      }
      case 'printInfoIntervalSec': {
        if (typeof value === 'number') {
          params.value = Math.max(1, Math.ceil(value));
          process.env.STREAM_PRINT_INFO_INTERVAL_SEC = String(params.value);
        }
        break;
      }
      case 'rectifierAccumulationTimeMillis': {
        if (typeof value === 'number') {
          params.value = Math.max(1, Math.ceil(value));
          process.env.RECTIFIER_ACCUMULATION_TIME_MILLIS = String(params.value);
          rectifier?.setAccumulationTimeMillis(value);
        }
        break;
      }
      case 'rectifierSendIntervalMillis': {
        if (typeof value === 'number') {
          params.value = Math.max(1, Math.ceil(value));
          process.env.RECTIFIER_SEND_INTERVAL_MILLIS = String(params.value);
          rectifier?.setSendIntervalMillis(value);
        }
        break;
      }
      case 'processHistoricalAlerts': {
        if (typeof value === 'boolean') {
          process.env.PROCESS_HISTORICAL_ALERTS = value ? '1' : '0';
        }
        break;
      }
      case 'skipGaps': {
        if (typeof value === 'boolean') {
          process.env.STREAM_SKIP_GAPS = value ? '1' : '0';
        }
        break;
      }
      case 'speed': {
        const speed = Math.floor(parseFloat(String(value)) || 0);
        if (speed < 1) {
          return;
        }
        process.env.STREAM_SPEED = String(speed);
        virtualTimeObj.setSpeed(value);
        break;
      }
      case 'startFromLastStop': {
        if (typeof value === 'boolean') {
          process.env.STREAM_USE_START_TIME_FROM_REDIS_CACHE = value ? '1' : '0';
          virtualTimeObj.options.startTimeRedis.options.startTimeConfig.useStartTimeFromRedisCache = value;
        }
        break;
      }
      case 'streamSendIntervalMillis': {
        if (typeof value === 'number') {
          params.value = Math.max(1, Math.ceil(value));
          process.env.STREAM_SEND_INTERVAL_MILLIS = String(params.value);
        }
        break;
      }
      case 'streamStartBefore': {
        if (timeParamRE.test(String(value || ''))) {
          process.env.STREAM_START_BEFORE = value;
        }
        break;
      }
      case 'streamStartTime': {
        const dt = DateTime.fromISO(String(value));
        if (dt.isValid) {
          process.env.STREAM_START_TIME = String(value);
        }
        break;
      }
      case 'timeFrontUpdateIntervalMillis': {
        if (typeof value === 'number') {
          params.value = Math.max(1, Math.ceil(value));
          process.env.STREAM_TIME_FRONT_UPDATE_INTERVAL_MILLIS = String(params.value);
          virtualTimeObj?.setTimeFrontUpdateIntervalMillis(value);
        }
        break;
      }
    }
  });
  reloadStreamsEnv();

  streams.forEach((stream) => {
    changeStreamParams(stream, params);
  });
};
