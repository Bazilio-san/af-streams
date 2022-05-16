import { DateTime } from 'luxon';
import EventEmitter from 'events';
import { IEcho } from './interfaces';
import { c, rs } from './utils/color';
import { MILLIS_IN_DAY, MILLIS_IN_HOUR } from './constants';

export interface IVirtualTimeObjOptions {
  startTime: number, // timestamp millis
  eventEmitter: EventEmitter,
  speed?: number,
  loopTimeMillis?: number,
  echo?: IEcho,
  exitOnError: Function,
}

export class VirtualTimeObj {
  private options: IVirtualTimeObjOptions;

  public speed: number;

  private loopTimeMillis: number;

  public virtualStartTs: number;

  private loopTimeMillsEnd: 0 | number;

  public realStartTs: number;

  public realStartTsLoopSafe: number;

  public loopNumber: number;

  public ready: boolean;

  public isCurrentTime: boolean;

  private eventEmitter: EventEmitter;

  private readonly debug: Function;

  private prevVirtualDateNumber: number = 0;

  private prevVirtualHourNumber: number = 0;

  constructor (options: IVirtualTimeObjOptions) {
    const { startTime, speed, loopTimeMillis = 0, eventEmitter, echo } = options;

    this.options = options;
    this.speed = Number(speed) || 1;
    this.loopTimeMillis = loopTimeMillis;
    this.virtualStartTs = +startTime; // timestamp millis from which to start uploading data
    this.loopTimeMillsEnd = loopTimeMillis && (this.virtualStartTs + loopTimeMillis);
    this.realStartTs = Date.now();
    this.realStartTsLoopSafe = Date.now();
    this.loopNumber = 0;
    this.ready = false; // flag: all sources are ready to give data
    this.isCurrentTime = false; // flag: virtual time has caught up with real time
    this.eventEmitter = eventEmitter;
    this.debug = echo ? echo.debug.bind(echo) : (m: string) => {
      // eslint-disable-next-line no-console
      console.log(m);
    };
  }

  setVirtualNumbers (vt: number) {
    const { prevVirtualDateNumber: pvd, prevVirtualHourNumber: pvh } = this;
    this.prevVirtualDateNumber = Math.floor(vt / MILLIS_IN_DAY);
    if (pvd && pvd < this.prevVirtualDateNumber) {
      this.eventEmitter.emit('virtual-date-changed', {
        prevN: pvd,
        currN: this.prevVirtualDateNumber,
        prevTs: pvd * MILLIS_IN_DAY,
        currTs: this.prevVirtualDateNumber * MILLIS_IN_DAY,
      });
    }
    this.prevVirtualHourNumber = Math.floor(vt / MILLIS_IN_HOUR);
    if (pvh && pvh !== this.prevVirtualHourNumber) {
      this.eventEmitter.emit('virtual-hour-changed', {
        prevN: pvh,
        currN: this.prevVirtualHourNumber,
        prevHZ: pvh % 24,
        currHZ: this.prevVirtualHourNumber % 24,
        prevTs: pvh * MILLIS_IN_HOUR,
        currTs: this.prevVirtualHourNumber * MILLIS_IN_HOUR,
      });
    }
    return vt;
  }

  getVirtualTs () {
    const now = Date.now();
    const { isCurrentTime, virtualStartTs, realStartTs, speed, loopTimeMillis, loopTimeMillsEnd } = this;
    if (isCurrentTime) {
      return this.setVirtualNumbers(now);
    }

    let vt = virtualStartTs + (now - realStartTs) * speed;
    if (loopTimeMillis && vt >= loopTimeMillsEnd) {
      vt = virtualStartTs;
      this.realStartTs = now;
      this.loopNumber++;
      this.debug(`[AF-STREAM]: New cycle from ${this.getString()}`);
      this.eventEmitter.emit('virtual-time-loop-back');
      return this.setVirtualNumbers(vt);
    }

    if (vt >= now) {
      this.eventEmitter.emit('virtual-time-is-synchronized-with-current');
      this.isCurrentTime = true;
      return this.setVirtualNumbers(now);
    }
    return this.setVirtualNumbers(vt);
  }

  setReady () {
    this.realStartTs = Date.now();
    this.ready = true;
  }

  getString () {
    return `${c}<${DateTime.fromMillis(this.getVirtualTs()).toISO()}${this.isCurrentTime ? '*' : ''}>${rs}`;
  }
}

let virtualTimeObj: VirtualTimeObj;
export const getVirtualTimeObj = (options: IVirtualTimeObjOptions): VirtualTimeObj => {
  if (!virtualTimeObj) {
    virtualTimeObj = new VirtualTimeObj(options);
  }
  return virtualTimeObj;
};
