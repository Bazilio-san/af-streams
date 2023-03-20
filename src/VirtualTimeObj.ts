import EventEmitter from 'events';
import { clearInterval } from 'timers';
import { IEcho, IEmVirtualDateChanged, IEmVirtualHourChanged, IStreamLike } from './interfaces';
import { c, rs } from './utils/color';
import { DEFAULTS, MILLIS_IN_DAY, MILLIS_IN_HOUR } from './constants';
import { millis2iso } from './utils/date-utils';
import { intEnv } from './utils/utils';

export interface IVirtualTimeObjOptions {
  startTime: number, // timestamp millis
  eventEmitter: EventEmitter,
  speed?: number,
  loopTimeMillis?: number,
  echo?: IEcho,
  exitOnError: Function,
  speedCalcIntervalSec?: number,
  timeFrontUpdateIntervalMillis?: number,
}

export class VirtualTimeObj {
  public readonly realStartTs: number;

  public readonly virtualStartTs: number;

  public loopNumber: number;

  public isCurrentTime: boolean;

  public locked: boolean = true;

  private streams: IStreamLike[] = [];

  public readonly loopTimeMillis: number;

  private readonly loopTimeMillsEnd: 0 | number;

  private timeFront: number = 0;

  private eventEmitter: EventEmitter;

  private readonly debug: Function;

  private prevVirtualDateNumber: number = 0;

  private prevVirtualHourNumber: number = 0;

  private stat: {
    lastRealTs: number,
    lastFrontTs: number,
    speed: number,
  };

  private frontUpdateInterval: any;

  private timeFrontUpdateInterval: any;

  constructor (public options: IVirtualTimeObjOptions) {
    const { startTime, loopTimeMillis = 0, eventEmitter, echo } = options;

    this.options = options;
    this.setSpeed();
    this.loopTimeMillis = loopTimeMillis;
    this.virtualStartTs = +startTime; // timestamp millis from which to start uploading data
    this.timeFront = this.virtualStartTs;
    this.loopTimeMillsEnd = loopTimeMillis && (this.virtualStartTs + loopTimeMillis);
    this.realStartTs = Date.now();
    this.loopNumber = 0;
    this.isCurrentTime = false; // flag: virtual time has caught up with real time
    this.eventEmitter = eventEmitter;
    this.debug = echo ? echo.debug.bind(echo) : (m: string) => {
      // eslint-disable-next-line no-console
      console.log(m);
    };

    this.setTimeFrontUpdateIntervalMillis();

    this.stat = {
      lastRealTs: Date.now(),
      lastFrontTs: this.virtualStartTs,
      speed: 0,
    };

    this.setSpeedCalcIntervalSec();
  }

  setSpeed (value?: number) {
    this.options.speed = (value && Number(value))
      || Number(this.options.speed)
      || intEnv('STREAM_SPEED', 1);
  }

  setTimeFrontUpdateIntervalMillis (value?: number) {
    value = (value && Number(value))
      || Number(this.options.timeFrontUpdateIntervalMillis)
      || intEnv('STREAM_TIME_FRONT_UPDATE_INTERVAL_MILLIS', DEFAULTS.TIME_FRONT_UPDATE_INTERVAL_MILLIS); // 5 ms
    this.options.timeFrontUpdateIntervalMillis = value;
    clearInterval(this.frontUpdateInterval);
    this.frontUpdateInterval = setInterval(() => {
      if (this.locked) {
        return;
      }
      this.setNextTimeFront();
      this.loopIfNeed();
      this.detectDayChange();
      this.detectHourChange();
    }, this.options.timeFrontUpdateIntervalMillis);
  }

  setSpeedCalcIntervalSec (value?: number) {
    value = (value && Number(value))
      || Number(this.options.speedCalcIntervalSec)
      || intEnv('STREAM_SPEED_CALC_INTERVAL_SEC', DEFAULTS.SPEED_CALC_INTERVAL_SEC); // 10 s
    this.options.speedCalcIntervalSec = value;
    clearInterval(this.timeFrontUpdateInterval);
    this.timeFrontUpdateInterval = setInterval(() => {
      const dReal = Date.now() - this.stat.lastRealTs;
      const dVirtual = this.timeFront - this.stat.lastFrontTs;
      this.stat.speed = dReal ? Math.ceil(dVirtual / dReal) : 0;

      this.stat.lastRealTs = Date.now();
      this.stat.lastFrontTs = this.timeFront;
    }, this.options.speedCalcIntervalSec * 1000);
  }

  setNextTimeFront (): [boolean, number] {
    const now = Date.now();
    if (this.isCurrentTime) {
      this.timeFront = now;
      return [true, now];
    }

    const timeShift: number = (this.options.timeFrontUpdateIntervalMillis || DEFAULTS.TIME_FRONT_UPDATE_INTERVAL_MILLIS) * (this.options.speed || 1);
    if (this.streams.length) {
      this.timeFront = Math.min(...this.streams.map((stream) => stream.getDesiredTimeFront(this.timeFront, timeShift)));
    } else {
      this.timeFront += timeShift;
    }
    if (this.timeFront >= now) {
      this.timeFront = now;
      this.isCurrentTime = true;
      this.eventEmitter.emit('virtual-time-is-synchronized-with-current');
    }
    return [this.isCurrentTime, this.timeFront];
  }

  private loopIfNeed () {
    if (this.loopTimeMillis && this.timeFront >= this.loopTimeMillsEnd) {
      this.timeFront = this.virtualStartTs;
      this.loopNumber++;
      this.debug(`[af-streams]: New cycle from ${this.virtualTimeString}`);
      this.eventEmitter.emit('virtual-time-loop-back');
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
      this.eventEmitter.emit('virtual-date-changed', payload);
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
      this.eventEmitter.emit('virtual-hour-changed', payload);
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

export const getVirtualTimeObj = (options: IVirtualTimeObjOptions): VirtualTimeObj => {
  if (!virtualTimeObj) {
    virtualTimeObj = new VirtualTimeObj(options);
  }
  return virtualTimeObj;
};
