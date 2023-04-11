import EventEmitter from 'events';
import { TMergeResult } from './i-alert';

export interface IStatTT {
  total: number,
  today: number,
}

export interface TIU {
  t: number,
  i: number,
  u: number,
}

export interface IStatTTtiu {
  total: TIU,
  today: TIU,
}

const iniTIU = (): TIU => ({ t: 0, i: 0, u: 0 });
const iniTTtiu = (): IStatTTtiu => ({ total: iniTIU(), today: iniTIU() });
const tiuPlus = (obj: IStatTTtiu, mergeResult: TMergeResult) => {
  const { total, inserted, updated } = mergeResult;
  ['total', 'today'].forEach((key) => {
    const o = obj[key as keyof IStatTTtiu];
    o.t += total;
    o.i += inserted;
    o.u += updated;
  });
};

export class AlertsStat {
  public addedToBuffer: IStatTT = { total: 0, today: 0 };

  public sentByEmail: IStatTT = { total: 0, today: 0 };

  public savedToDb: {
    all: IStatTTtiu,
    byAlertType: {
      [eventName: string]: IStatTTtiu
    }
  } = { all: iniTTtiu(), byAlertType: {} };

  private callbackOnVDC: (...args: any[]) => void;

  constructor (private eventEmitter: EventEmitter) {
    this.callbackOnVDC = this.clearDayStat.bind(this);
    // Сброс дневной статистики при смене суток // #1 / 0
    this.eventEmitter.on('virtual-date-changed', this.callbackOnVDC);
  }

  clearDayStat () {
    // Сброс дневной статистики при смене суток
    this.addedToBuffer.today = 0;
    this.sentByEmail.today = 0;
    this.savedToDb.all.today = iniTIU();
    Object.values(this.savedToDb.byAlertType).forEach((statAlertTyped: IStatTTtiu) => {
      statAlertTyped.today = iniTIU();
    });
  }

  oneAddedToBuffer () {
    this.addedToBuffer.total += 1;
    this.addedToBuffer.today += 1;
  }

  oneSentByEmail () {
    this.sentByEmail.total += 1;
    this.sentByEmail.today += 1;
  }

  anySavedToDb (eventName: string, mergeResult: TMergeResult) {
    const { all, byAlertType } = this.savedToDb;
    tiuPlus(all, mergeResult);
    let obj = byAlertType[eventName];
    if (!obj) {
      byAlertType[eventName] = iniTTtiu();
      obj = byAlertType[eventName];
    }
    tiuPlus(obj, mergeResult);
  }

  getDiagnostics (indents: number = 1): string {
    const tab = (n: number = 1) => `${'    '.repeat(n)}`;
    const indent = `\n${tab(indents)}`;
    const { addedToBuffer, sentByEmail, savedToDb } = this;

    const tiu = (obj: IStatTTtiu, prop: keyof IStatTTtiu, tabs: number) => {
      const v = obj[prop];
      return `${tab(tabs)}${prop}: t/i/u: ${v.t} / ${v.i} / ${v.u}`;
    };
    const ttiu = (obj: IStatTTtiu, tabs: number) => `${tiu(obj, 'total', tabs)} | ${tiu(obj, 'today', tabs)}`;
    const tt = (obj: IStatTT, tabs: number) => `${tab(tabs)}total: ${obj.total}${tab(tabs)}today: ${obj.today}`;

    let alertsBufferTxt = ``;
    alertsBufferTxt += `${indent}Added to buffer: ${tt(addedToBuffer, 2)}`;
    alertsBufferTxt += `${indent}Sent by email:   ${tt(sentByEmail, 2)}`;
    alertsBufferTxt += `${indent}Saved to db: ALL:${ttiu(savedToDb.all, 2)}`;
    Object.entries(savedToDb.byAlertType).forEach(([key, item]: [string, IStatTTtiu]) => {
      alertsBufferTxt += `${indent}${tab()}${key}: ${ttiu(item, 2)}`;
    });
    return alertsBufferTxt;
  }

  destroy () {
    this.eventEmitter.removeListener('virtual-date-changed', this.callbackOnVDC);
    // @ts-ignore
    this.callbackOnVDC = undefined;
    // @ts-ignore
    this.eventEmitter = undefined;
    // @ts-ignore
    this.addedToBuffer = undefined;
    // @ts-ignore
    this.sentByEmail = undefined;
    // @ts-ignore
    this.savedToDb.all = undefined;
    Object.keys(this.savedToDb.byAlertType).forEach((key) => {
      // @ts-ignore
      this.savedToDb.byAlertType[key] = undefined;
    });
    // @ts-ignore
    this.savedToDb = undefined;
  }
}
