// noinspection JSUnusedGlobalSymbols

import { clearInterval } from 'timers';
import EventEmitter from 'events';
import { bg, bold, boldOff, c, rs, y } from 'af-color';
import { infoBlock, millisTo } from 'af-tools-ts';
import { ICommonConfig, IEmVirtualDateChanged, IEmVirtualHourChanged, IStreamLike } from './interfaces';
import { MILLIS_IN_DAY, MILLIS_IN_HOUR } from './constants';
import { PARAMS } from './params';
import { getStartTimeRedis } from './StartTimeRedis';

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
    millis: number, // Количество миллисекунд, когда сервис был в работе (остановки не в счет)
  } = { prevTs: Date.now(), millis: 0, expectedTimeFront: 0 };

  loopNumber: number = 0;

  isCurrentTime: boolean = false;

  locked: boolean = true;

  streams: IStreamLike[] = [];

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

  ee: EventEmitter;

  constructor (public commonConfig: ICommonConfig) {
    this.virtualStartTs = PARAMS.timeStartMillis; // timestamp millis from which to start uploading data
    this.ee = commonConfig.eventEmitter;
    this.runningRealTime.expectedTimeFront = PARAMS.timeStartMillis;

    this.reset();
    this.startUpInfo();
  }

  private updateRunningTime () {
    const { prevTs } = this.runningRealTime;
    const now = Date.now();
    if (!this.locked) {
      this.runningRealTime.millis += (now - prevTs);
    }
    this.runningRealTime.prevTs = now;
    this.runningRealTime.expectedTimeFront = Math.max(this.virtualStartTs + this.runningRealTime.millis * PARAMS.speed, this.timeFront);
  }

  private timeFrontLoop () {
    clearTimeout(this._frontUpdateTimer);
    if (!this.locked) {
      this.updateRunningTime();
      this.setNextTimeFront();

      this._loopIfNeed();
      this._detectDayChange();
      this._detectHourChange();
      if (PARAMS.timeStopMillis && this.timeFront >= PARAMS.timeStopMillis) {
        this.lock();
        this.ee.emit('virtual-time-stopped-at', PARAMS.timeStopMillis);
      }
    }

    this._frontUpdateTimer = setTimeout(() => {
      this.timeFrontLoop();
    }, PARAMS.timeFrontUpdateIntervalMillis);
  }

  private startCyclicSpeedCalc () {
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
    this.timeFront = this.virtualStartTs;
    this.realStartTs = Date.now(); // Переустанавливать при запуске
    this.loopNumber = 0;
    this.isCurrentTime = false; // flag: virtual time has caught up with real time
    this.stat.arr = [];
  }

  startUpInfo () {
    const { echo } = this.commonConfig;

    const info: [string, any][] = [
      ['Start from', `${millisTo.iso.z(PARAMS.timeStartMillis)} ${y}${bold}${PARAMS.timeStartType}${boldOff}`],
      ['Speed', `${bold}${PARAMS.speed} X`],
    ];
    if (PARAMS.timeStopMillis) {
      info.push(['Stop at', `${bg.yellow}${millisTo.iso.z(PARAMS.timeStopMillis)}${bg.def}`]);
    }
    if (PARAMS.loopTimeMillis) {
      info.push(['Cyclic', `${bg.yellow}${(PARAMS.loopTimeMillis as number) / 1000} sec${bg.def}`]);
    }
    infoBlock({
      echo,
      title: '[af-streams:VT]',
      padding: 0,
      info,
    });
  }

  async start () {
    const { commonConfig } = this;
    await getStartTimeRedis({ commonConfig }).defineStartTime();
    this.virtualStartTs = PARAMS.timeStartMillis;
    this.reset();
    this.startUpInfo();
    this.timeFrontLoop();
    this.startCyclicSpeedCalc(); // VVQ вынести в старт
  }

  hardStop () {
    this.lock();

    clearTimeout(this._frontUpdateTimer);
    this._frontUpdateTimer = undefined;
    clearInterval(this._speedCalcTimer);
    this._speedCalcTimer = undefined;

    const now = Date.now();
    this.timeFront = now;
    this.realStartTs = now;
    this.loopNumber = 0;
    this.stat.arr = [];
  }

  setNextTimeFront (): [boolean, number] {
    const now = Date.now();
    if (this.isCurrentTime || this.locked) {
      this.timeFront = now;
      return [true, now];
    }
    const timeShift: number = PARAMS.timeFrontUpdateIntervalMillis * PARAMS.speed;
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
    if (PARAMS.loopTimeMillis && this.timeFront >= (this.virtualStartTs + PARAMS.loopTimeMillis)) {
      this.timeFront = this.virtualStartTs;
      this.loopNumber++;
      this.commonConfig.echo(`[af-streams]: ${bg.yellow}New cycle from ${this.virtualTimeString}${bg.def}`);
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

  get totalSpeed () {
    const d = Date.now() - this.realStartTs;
    return d ? Math.ceil((this.timeFront - this.virtualStartTs) / d) : 0;
  }

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

export const getVirtualTimeObj = async (commonConfig: ICommonConfig): Promise<VirtualTimeObj> => {
  if (virtualTimeObj) {
    return virtualTimeObj;
  }
  return new VirtualTimeObj(commonConfig);
};
