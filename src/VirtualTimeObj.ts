import EventEmitter from 'events';
import { IEcho, IEmVirtualDateChanged, IEmVirtualHourChanged, IStreamLike } from './interfaces';
import { c, rs } from './utils/color';
import { MILLIS_IN_DAY, MILLIS_IN_HOUR } from './constants';
import { millis2iso } from './utils/utils';

const TIME_FRONT_UPDATE_INTERVAL_MILLIS = 3;

export interface IVirtualTimeObjOptions {
  startTime: number, // timestamp millis
  eventEmitter: EventEmitter,
  speed?: number,
  loopTimeMillis?: number,
  echo?: IEcho,
  exitOnError: Function,
  speedCalcInterval?: number,
}

export class VirtualTimeObj {
  public speed: number;

  public readonly realStartTs: number;

  public readonly virtualStartTs: number;

  public loopNumber: number;

  public isCurrentTime: boolean;

  public locked: boolean = true;

  private streams: IStreamLike[] = [];

  private options: IVirtualTimeObjOptions;

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

  constructor (options: IVirtualTimeObjOptions) {
    const { startTime, speed, loopTimeMillis = 0, eventEmitter, echo } = options;

    this.options = options;
    this.speed = Number(speed) || 1;
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
    setInterval(() => {
      if (this.locked) {
        return;
      }
      this.setNextTimeFront();
      this.loopIfNeed();
      this.detectDayChange();
      this.detectHourChange();
    }, TIME_FRONT_UPDATE_INTERVAL_MILLIS);

    this.stat = {
      lastRealTs: Date.now(),
      lastFrontTs: this.virtualStartTs,
      speed: 0,
    };

    setInterval(() => {
      const dReal = Date.now() - this.stat.lastRealTs;
      const dVirtual = this.timeFront - this.stat.lastFrontTs;
      this.stat.speed = dReal ? Math.ceil(dVirtual / dReal) : 0;

      this.stat.lastRealTs = Date.now();
      this.stat.lastFrontTs = this.timeFront;
    }, options.speedCalcInterval || 10_000);
  }

  private setNextTimeFront () {
    const now = Date.now();
    if (this.isCurrentTime) {
      this.timeFront = now;
      return;
    }

    const timeShift: number = TIME_FRONT_UPDATE_INTERVAL_MILLIS * this.speed;
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
