import { DateTime } from 'luxon';
import EventEmitter from 'events';
import { IEcho } from './interfaces';
import { c, rs } from './utils/color';

export interface IVirtualTimeObjOptions {
  startTime: number,
  eventEmitter: EventEmitter,
  speed?: number,
  loopTimeMillis?: number,
  echo?: IEcho,
  exitOnError: Function,
}

export class VirtualTimeObj {
  private options: IVirtualTimeObjOptions;

  private speed: number;

  private loopTimeMillis: number;

  public virtualStartTs: number;

  private loopTimeMillsEnd: 0 | number;

  private realStartTs: number;

  public realStartTsLoopSafe: number;

  public loopNumber: number;

  public ready: boolean;

  private isCurrentTime: boolean;

  private eventEmitter: EventEmitter;

  private readonly debug: Function;

  constructor (options: IVirtualTimeObjOptions) {
    const { startTime, speed, loopTimeMillis = 0, eventEmitter, echo } = options;

    this.options = options;
    this.speed = Number(speed) || 1;
    this.loopTimeMillis = loopTimeMillis;
    this.virtualStartTs = +startTime; // метка времени, с которого надо начать выгрузку данных
    this.loopTimeMillsEnd = loopTimeMillis && (this.virtualStartTs + loopTimeMillis);
    this.realStartTs = Date.now();
    this.realStartTsLoopSafe = Date.now();
    this.loopNumber = 0;
    this.ready = false; // признак того, что все источники готовы выдать данные
    this.isCurrentTime = false; // признак того, что виртуальное время догнало реальное
    this.eventEmitter = eventEmitter;
    this.debug = echo ? echo.debug.bind(echo) : (m: string) => {
      // eslint-disable-next-line no-console
      console.log(m);
    };
  }

  getVirtualTs () {
    const now = Date.now();
    const { isCurrentTime, virtualStartTs, realStartTs, speed, loopTimeMillis, loopTimeMillsEnd } = this;
    if (isCurrentTime) {
      return now;
    }
    let vt = virtualStartTs + (now - realStartTs) * speed;
    if (loopTimeMillis && vt >= loopTimeMillsEnd) {
      vt = virtualStartTs;
      this.realStartTs = now;
      this.loopNumber++;
      this.debug(`======== Новый цикл, начиная с ${this.getString()}`);
      this.eventEmitter.emit('virtual-time-loop-back');
      return vt;
    }
    if (vt >= now) {
      this.isCurrentTime = true;
      return now;
    }
    return vt;
  }

  setReady () {
    this.realStartTs = Date.now();
    this.ready = true;
  }

  getString () {
    return `${c}:: ${DateTime.fromMillis(this.getVirtualTs()).toISO()}${this.isCurrentTime ? '*' : ''} ::${rs}`;
  }
}

let virtualTimeObj: VirtualTimeObj;
export const getVirtualTimeObj = (options: IVirtualTimeObjOptions): VirtualTimeObj => {
  if (!virtualTimeObj) {
    virtualTimeObj = new VirtualTimeObj(options);
  }
  return virtualTimeObj;
};
