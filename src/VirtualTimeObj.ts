// noinspection JSUnusedGlobalSymbols

import { clearInterval } from 'timers';
import EventEmitter from 'events';
import { bold, boldOff, c, rs, y } from 'af-color';
import { infoBlock, intEnv, millisTo } from 'af-tools-ts';
import { DateTime } from 'luxon';
import { ICommonConfig, IEmVirtualDateChanged, IEmVirtualHourChanged, IStartTimeConfig, IStreamLike, IVirtualTimeConfig } from './interfaces';
import { DEFAULTS, MILLIS_IN_DAY, MILLIS_IN_HOUR } from './constants';
import { getStartTimeRedis, StartTimeRedis } from './StartTimeRedis';

export interface IVirtualTimeObjOptions {
  commonConfig: ICommonConfig,
  virtualTimeConfig: IVirtualTimeConfig,
  startTimeRedis: StartTimeRedis,
  startTimeMillis: number,
  isUsedSavedStartTime: boolean,
}

export interface IVirtualTimeStat {
  arr: [number, number][],
  interval: number,
  maxNumberOfItems: number,
  speed: number,
}

export class VirtualTimeObj {
  realStartTs: number = 0;

  virtualStartTs: number;

  runningRealTime: {
    prevTs: number,
    expectedTimeFront: number,
    millis: number, // Количество миллисекунд, когда сервис был в работе (остановки не всчет)
  } = { prevTs: Date.now(), millis: 0, expectedTimeFront: 0 };

  loopNumber: number = 0;

  isCurrentTime: boolean = false;

  locked: boolean = true;

  streams: IStreamLike[] = [];

  loopTimeMillis: number = 0;

  loopTimeMillsEnd: number = 0;

  timeFront: number = 0;

  prevVirtualDateNumber: number = 0;

  prevVirtualHourNumber: number = 0;

  stat: IVirtualTimeStat = {
    arr: [],
    interval: 500,
    maxNumberOfItems: 20,
    get speed () {
      if (this.arr.length < 2) {
        return 0;
      }
      const [real1, virt1] = this.arr[0];
      const [real2, virt2] = this.arr[this.arr.length - 1];
      return Math.ceil((virt2 - virt1) / (real2 - real1));
    },
  };

  _frontUpdateTimer: any;

  _speedCalcTimer: any;

  timeFrontUpdateIntervalMillis: number = 0;

  speed: number = 1;

  stopAt: number = 0;

  ee: EventEmitter;

  constructor (public options: IVirtualTimeObjOptions) {
    this.virtualStartTs = options.startTimeMillis; // timestamp millis from which to start uploading data
    this.ee = options.commonConfig.eventEmitter;
    this.runningRealTime.expectedTimeFront = options.startTimeMillis;
    this.reset();
    this.startUpInfo();
  }

  setStopAt () {
    const { STREAM_STOP_TIME = '' } = process.env;
    if (!STREAM_STOP_TIME) {
      return;
    }
    const dt = DateTime.fromISO(STREAM_STOP_TIME, { zone: 'GMT' });
    if (dt.isValid) {
      this.stopAt = dt.toMillis();
    }
  }

  setLoopTimeMillis (value?: number) {
    value = (value && Number(value))
      || Number(this.options.virtualTimeConfig.loopTimeMillis)
      || intEnv('STREAM_LOOP_TIME_MILLIS', 0);
    this.loopTimeMillis = value;
    this.loopTimeMillsEnd = value && (this.virtualStartTs + value);
  }

  setSpeed (value?: number) {
    value = (value && Number(value))
      || Number(this.options.virtualTimeConfig.speed)
      || intEnv('STREAM_SPEED', 1);
    this.options.virtualTimeConfig.speed = value;
    this.speed = Math.max(1, value);
  }

  updateRunningTime () {
    const { prevTs } = this.runningRealTime;
    const now = Date.now();
    if (!this.locked) {
      this.runningRealTime.millis += (now - prevTs);
    }
    this.runningRealTime.prevTs = now;
    this.runningRealTime.expectedTimeFront = Math.max(this.virtualStartTs + this.runningRealTime.millis * this.speed, this.timeFront);
  }

  setTimeFrontUpdateIntervalMillis (value?: number) {
    value = (value && Number(value))
      || Number(this.options.virtualTimeConfig.timeFrontUpdateIntervalMillis)
      || intEnv('STREAM_TIME_FRONT_UPDATE_INTERVAL_MILLIS', DEFAULTS.TIME_FRONT_UPDATE_INTERVAL_MILLIS); // 5 ms
    this.options.virtualTimeConfig.timeFrontUpdateIntervalMillis = value;
    this.timeFrontUpdateIntervalMillis = value;

    clearInterval(this._frontUpdateTimer);
    this._frontUpdateTimer = setInterval(() => {
      if (this.locked) {
        return;
      }
      this.updateRunningTime();
      this.setNextTimeFront();

      this._loopIfNeed();
      this._detectDayChange();
      this._detectHourChange();
      if (this.stopAt && this.timeFront >= this.stopAt) {
        this.lock();
        this.ee.emit('virtual-time-stopped-at', this.stopAt);
      }
    }, this.timeFrontUpdateIntervalMillis);
  }

  startCyclicSpeedCalc () {
    clearInterval(this._speedCalcTimer);
    const { stat } = this;
    const { arr, maxNumberOfItems } = stat;
    this._speedCalcTimer = setInterval(() => {
      arr.push([Date.now(), this.timeFront]);
      if (arr.length > maxNumberOfItems) {
        arr.splice(0, maxNumberOfItems - arr.length);
      }
      this.updateRunningTime();
    }, 500);
  }

  reset () {
    const now = Date.now();
    this.timeFront = this.virtualStartTs;
    this.realStartTs = now; // Переустанавливать при запуске
    this.loopNumber = 0;
    this.isCurrentTime = false; // flag: virtual time has caught up with real time
    this.stat.arr = [];
    this.setLoopTimeMillis();
    this.setSpeed();
    this.setTimeFrontUpdateIntervalMillis();
    this.startCyclicSpeedCalc();
  }

  hardStop () {
    this.lock();
    clearInterval(this._frontUpdateTimer);
    clearInterval(this._speedCalcTimer);
    const now = Date.now();
    this.timeFront = now;
    this.realStartTs = now;
    this.loopNumber = 0;
    this.stat.arr = [];
    this.speed = 0;
  }

  startUpInfo () {
    const { options, stopAt, loopTimeMillis } = this;
    const { echo } = options.commonConfig;

    let startFrom = millisTo.iso.z(options.startTimeMillis);
    if (options.startTimeRedis.options.startTimeConfig.useStartTimeFromRedisCache) {
      startFrom += `${y}${bold} ${options.isUsedSavedStartTime ? `TAKEN FROM CACHE` : 'NOW'}${boldOff}`;
    }
    const info: [string, any][] = [
      ['Start from', startFrom],
      ['Speed', `${bold}${this.speed} X`],
    ];
    if (stopAt) {
      info.push(['Stop at', millisTo.iso.z(stopAt)]);
    }
    if (loopTimeMillis) {
      info.push(['Cyclic', `${loopTimeMillis / 1000} sec`]);
    }
    infoBlock({
      echo,
      title: '[af-streams:VT]',
      padding: 0,
      info,
    });
  }

  async resetWithStartTime () {
    const { isUsedSavedStartTime, startTimeMillis } = await this.options.startTimeRedis.getStartTime();
    this.options.startTimeMillis = startTimeMillis;
    this.virtualStartTs = startTimeMillis;
    this.options.isUsedSavedStartTime = isUsedSavedStartTime;
    this.reset();
  }

  setNextTimeFront (): [boolean, number] {
    const now = Date.now();
    if (this.isCurrentTime || this.locked) {
      this.timeFront = now;
      return [true, now];
    }
    const timeShift: number = this.timeFrontUpdateIntervalMillis * this.speed;
    const { streams, timeFront: lastTF } = this;
    if (streams.length) {
      const allGaps = streams.map(({ gapEdge: v }) => v);
      const minDesiredTimeFront = Math.min(...streams.map((stream) => stream.getDesiredTimeFront(lastTF, timeShift)));
      if (allGaps.every(Boolean)) {
        const minGapEdge = Math.min(...allGaps);
        streams.forEach((stream) => {
          stream.gapEdge = 0;
        });
        this.timeFront = Math.max(minGapEdge, minDesiredTimeFront);
      } else {
        this.timeFront = Math.min(minDesiredTimeFront, Math.max(lastTF, this.runningRealTime.expectedTimeFront) + timeShift);
      }
    } else {
      this.timeFront += timeShift;
    }
    if (this.timeFront >= now) {
      this.timeFront = now;
      this.isCurrentTime = true;
      this.ee.emit('virtual-time-is-synchronized-with-current');
    }
    return [this.isCurrentTime, this.timeFront];
  }

  _loopIfNeed () {
    if (this.loopTimeMillis && this.timeFront >= this.loopTimeMillsEnd) {
      this.timeFront = this.virtualStartTs;
      this.loopNumber++;
      this.options.commonConfig.echo(`[af-streams]: New cycle from ${this.virtualTimeString}`);
      this.ee.emit('virtual-time-loop-back');
    }
  }

  _detectDayChange () {
    const pvd = this.prevVirtualDateNumber;
    this.prevVirtualDateNumber = Math.floor(this.timeFront / MILLIS_IN_DAY);
    if (pvd && pvd < this.prevVirtualDateNumber) {
      const payload: IEmVirtualDateChanged = {
        prevN: pvd,
        currN: this.prevVirtualDateNumber,
        prevTs: pvd * MILLIS_IN_DAY,
        currTs: this.prevVirtualDateNumber * MILLIS_IN_DAY,
      };
      this.ee.emit('virtual-date-changed', payload);
    }
  }

  _detectHourChange () {
    const pvh = this.prevVirtualHourNumber;
    this.prevVirtualHourNumber = Math.floor(this.timeFront / MILLIS_IN_HOUR);
    if (pvh && pvh !== this.prevVirtualHourNumber) {
      const payload: IEmVirtualHourChanged = {
        prevN: pvh,
        currN: this.prevVirtualHourNumber,
        prevHZ: pvh % 24,
        currHZ: this.prevVirtualHourNumber % 24,
        prevTs: pvh * MILLIS_IN_HOUR,
        currTs: this.prevVirtualHourNumber * MILLIS_IN_HOUR,
      };
      this.ee.emit('virtual-hour-changed', payload);
    }
  }

  // noinspection JSUnusedGlobalSymbols
  get totalSpeed () {
    const d = Date.now() - this.realStartTs;
    return d ? Math.ceil((this.timeFront - this.virtualStartTs) / d) : 0;
  }

  // noinspection JSUnusedGlobalSymbols
  get lastSpeed () {
    return this.stat.speed;
  }

  // noinspection JSUnusedGlobalSymbols
  registerStream (stream: IStreamLike) {
    if (!this.streams.find((s) => stream === s)) {
      this.streams.push(stream);
    }
  }

  lock () {
    if (!this.locked) {
      this.locked = true;
      this.isCurrentTime = false;
    }
  }

  unLock () {
    if (this.locked) {
      this.locked = false;
    }
  }

  get virtualTs (): number {
    return this.timeFront;
  }

  get virtualTimeString (): string {
    return `${c}<${millisTo.iso.z(this.timeFront)}${this.isCurrentTime ? '*' : ''}>${rs}`;
  }

  get virtualTimeISO (): string | null {
    return millisTo.iso.z(this.timeFront);
  }

  get virtualStartTimeISO (): string | null {
    return millisTo.iso.z(this.virtualStartTs);
  }

  get realStartTimeISO (): string | null {
    return millisTo.iso.z(this.realStartTs);
  }
}

let virtualTimeObj: VirtualTimeObj;

export const getVirtualTimeObj = async (
  args: {
    commonConfig: ICommonConfig,
    virtualTimeConfig: IVirtualTimeConfig,
    startTimeConfig: IStartTimeConfig,
  },
): Promise<VirtualTimeObj> => {
  if (virtualTimeObj) {
    return virtualTimeObj;
  }
  const { commonConfig, virtualTimeConfig, startTimeConfig } = args;
  const startTimeRedis = getStartTimeRedis({ commonConfig, startTimeConfig });
  const { startTimeMillis, isUsedSavedStartTime } = await startTimeRedis.getStartTime();
  return new VirtualTimeObj({
    commonConfig,
    virtualTimeConfig,
    startTimeRedis,
    startTimeMillis,
    isUsedSavedStartTime,
  });
};
