// noinspection JSUnusedGlobalSymbols

import { clearInterval } from 'timers';
import { ICommonConfig, IEmVirtualDateChanged, IEmVirtualHourChanged, IStartTimeConfig, IStreamLike, IVirtualTimeConfig } from './interfaces';
import { bold, boldOff, c, g, m, rs, y } from './utils/color';
import { DEFAULTS, MILLIS_IN_DAY, MILLIS_IN_HOUR } from './constants';
import { millis2iso, millis2isoZ } from './utils/date-utils';
import { intEnv } from './utils/utils';
import { getStartTime } from './StartTimeRedis';

export interface IVirtualTimeObjOptions {
  startTimeMillis: number,
  isUsedSavedStartTime: boolean,
  useStartTimeFromRedisCache: boolean,

  commonConfig: ICommonConfig,
  virtualTimeConfig: IVirtualTimeConfig,
}

export interface IVirtualTimeStat {
  lastRealTs: number,
  lastFrontTs: number,
  speed: number,
}

export class VirtualTimeObj {
  public realStartTs: number = 0;

  public readonly virtualStartTs: number;

  public loopNumber: number = 0;

  public isCurrentTime: boolean = false;

  public locked: boolean = true;

  public streams: IStreamLike[] = [];

  public loopTimeMillis: number = 0;

  private loopTimeMillsEnd: number = 0;

  private timeFront: number = 0;

  private prevVirtualDateNumber: number = 0;

  private prevVirtualHourNumber: number = 0;

  private stat: IVirtualTimeStat = { lastRealTs: 0, lastFrontTs: 0, speed: 0 };

  private frontUpdateInterval: any;

  private timeFrontUpdateInterval: any;

  private timeFrontUpdateIntervalMillis: number = 0;

  public speed: number = 1;

  constructor (public options: IVirtualTimeObjOptions) {
    this.virtualStartTs = options.startTimeMillis; // timestamp millis from which to start uploading data

    this.reset();
    this.setLoopTimeMillis();
    this.setSpeed();
    this.setTimeFrontUpdateIntervalMillis();
    this.setSpeedCalcIntervalSec();

    const msg = ` [af-streams:VirtualTimeObj::Service:${options.commonConfig.serviceName}] `;
    const eq = '='.repeat(Math.max(1, Math.ceil((64 - msg.length) / 2)));
    const info = `${g}${eq}${msg}${eq}
${g}Start from beginning:  ${m}${options.useStartTimeFromRedisCache ? 'NOT' : 'YES'}
${g}Speed:                 ${m}${this.speed} X
${g}Cyclicity:             ${m}${this.loopTimeMillis ? `${this.loopTimeMillis / 1000} sec` : '-'}
${g}Start time:            ${m}${millis2isoZ(options.startTimeMillis)}${options.isUsedSavedStartTime ? `${y}${bold} TAKEN FROM CACHE${boldOff}${rs}${g}` : ''}
${g}${'='.repeat(64)}`;
    options.commonConfig.echo(info);
  }

  reset () {
    const now = Date.now();
    this.timeFront = this.virtualStartTs;
    this.realStartTs = now; // Переустанавливать при запуске
    this.loopNumber = 0;
    this.isCurrentTime = false; // flag: virtual time has caught up with real time
    this.stat = {
      lastRealTs: now,
      lastFrontTs: this.virtualStartTs,
      speed: 0,
    };
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

  setTimeFrontUpdateIntervalMillis (value?: number) {
    value = (value && Number(value))
      || Number(this.options.virtualTimeConfig.timeFrontUpdateIntervalMillis)
      || intEnv('STREAM_TIME_FRONT_UPDATE_INTERVAL_MILLIS', DEFAULTS.TIME_FRONT_UPDATE_INTERVAL_MILLIS); // 5 ms
    this.options.virtualTimeConfig.timeFrontUpdateIntervalMillis = value;
    this.timeFrontUpdateIntervalMillis = value;

    clearInterval(this.frontUpdateInterval);
    this.frontUpdateInterval = setInterval(() => {
      if (this.locked) {
        return;
      }
      this.setNextTimeFront();
      this.loopIfNeed();
      this.detectDayChange();
      this.detectHourChange();
    }, this.timeFrontUpdateIntervalMillis);
  }

  setSpeedCalcIntervalSec (value?: number) {
    value = (value && Number(value))
      || Number(this.options.virtualTimeConfig.speedCalcIntervalSec)
      || intEnv('STREAM_SPEED_CALC_INTERVAL_SEC', DEFAULTS.SPEED_CALC_INTERVAL_SEC); // 10 s
    this.options.virtualTimeConfig.speedCalcIntervalSec = value;

    clearInterval(this.timeFrontUpdateInterval);
    this.timeFrontUpdateInterval = setInterval(() => {
      const dReal = Date.now() - this.stat.lastRealTs;
      const dVirtual = this.timeFront - this.stat.lastFrontTs;
      this.stat.speed = dReal ? Math.ceil(dVirtual / dReal) : 0;

      this.stat.lastRealTs = Date.now();
      this.stat.lastFrontTs = this.timeFront;
    }, this.options.virtualTimeConfig.speedCalcIntervalSec * 1000);
  }

  setNextTimeFront (): [boolean, number] {
    const now = Date.now();
    if (this.isCurrentTime) {
      this.timeFront = now;
      return [true, now];
    }
    const timeShift: number = this.timeFrontUpdateIntervalMillis * this.speed;
    if (this.streams.length) {
      this.timeFront = Math.min(...this.streams.map((stream) => stream.getDesiredTimeFront(this.timeFront, timeShift)));
    } else {
      this.timeFront += timeShift;
    }
    if (this.timeFront >= now) {
      this.timeFront = now;
      this.isCurrentTime = true;
      this.options.commonConfig.eventEmitter.emit('virtual-time-is-synchronized-with-current');
    }
    return [this.isCurrentTime, this.timeFront];
  }

  private loopIfNeed () {
    if (this.loopTimeMillis && this.timeFront >= this.loopTimeMillsEnd) {
      this.timeFront = this.virtualStartTs;
      this.loopNumber++;
      this.options.commonConfig.echo(`[af-streams]: New cycle from ${this.virtualTimeString}`);
      this.options.commonConfig.eventEmitter.emit('virtual-time-loop-back');
    }
  }

  private detectDayChange () {
    const pvd = this.prevVirtualDateNumber;
    this.prevVirtualDateNumber = Math.floor(this.timeFront / MILLIS_IN_DAY);
    if (pvd && pvd < this.prevVirtualDateNumber) {
      const payload: IEmVirtualDateChanged = {
        prevN: pvd,
        currN: this.prevVirtualDateNumber,
        prevTs: pvd * MILLIS_IN_DAY,
        currTs: this.prevVirtualDateNumber * MILLIS_IN_DAY,
      };
      this.options.commonConfig.eventEmitter.emit('virtual-date-changed', payload);
    }
  }

  private detectHourChange () {
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
      this.options.commonConfig.eventEmitter.emit('virtual-hour-changed', payload);
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
      this.isCurrentTime = false;
      this.locked = true;
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
    return `${c}<${millis2iso(this.timeFront)}${this.isCurrentTime ? '*' : ''}>${rs}`;
  }

  get virtualTimeISO (): string {
    return millis2iso(this.timeFront);
  }

  get virtualStartTimeISO (): string {
    return millis2iso(this.virtualStartTs);
  }

  get realStartTimeISO (): string {
    return millis2iso(this.realStartTs);
  }

  // noinspection JSUnusedGlobalSymbols
  /** @deprecated */
  setVirtualTs (ts: number) {
    this.timeFront = ts;
  }

  // For compatibility
  /** @deprecated */
  setReady (): void {
    this.unLock();
  }

  /** @deprecated */
  getVirtualTs (): number {
    return this.timeFront;
  }

  /** @deprecated */
  getString (): string {
    return this.virtualTimeString;
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
  const { startTimeMillis, isUsedSavedStartTime } = await getStartTime({ commonConfig, startTimeConfig });
  return new VirtualTimeObj({
    commonConfig,
    virtualTimeConfig,
    startTimeMillis,
    isUsedSavedStartTime,
    useStartTimeFromRedisCache: !!startTimeConfig.useStartTimeFromRedisCache,
  });
};
