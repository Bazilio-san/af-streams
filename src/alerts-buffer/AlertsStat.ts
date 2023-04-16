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

const iniTT = (): IStatTT => ({ total: 0, today: 0 });
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

export type TAlertTTStat = {
  all: IStatTT,
  byEventName: {
    [eventName: string]: IStatTT,
  },
}

const addOne = (stat: TAlertTTStat, eventName: string) => {
  const { all, byEventName } = stat;
  let obj = byEventName[eventName];
  if (!obj) {
    byEventName[eventName] = iniTT();
    obj = byEventName[eventName];
  }
  [all, obj].forEach((v) => {
    v.total++;
    v.today++;
  });
};

export class AlertsStat {
  public addedToBuffer: TAlertTTStat = { all: iniTT(), byEventName: {} };

  public sentByEmail: TAlertTTStat = { all: iniTT(), byEventName: {} };

  public savedToDb: {
    all: IStatTTtiu,
    byEventName: {
      [eventName: string]: IStatTTtiu
    }
  } = { all: iniTTtiu(), byEventName: {} };

  private callbackOnVDC: (...args: any[]) => void;

  constructor (private eventEmitter: EventEmitter) {
    this.callbackOnVDC = this.clearDayStat.bind(this);
    // Сброс дневной статистики при смене суток // #1 / 0
    this.eventEmitter.on('virtual-date-changed', this.callbackOnVDC);
  }

  clearDayStat () {
    // Сброс дневной статистики при смене суток
    this.addedToBuffer.all.today = 0;
    Object.values(this.addedToBuffer.byEventName).forEach((s: IStatTT) => {
      s.today = 0;
    });
    this.sentByEmail.all.today = 0;
    Object.values(this.sentByEmail.byEventName).forEach((s: IStatTT) => {
      s.today = 0;
    });
    this.savedToDb.all.today = iniTIU();
    Object.values(this.savedToDb.byEventName).forEach((statAlertTyped: IStatTTtiu) => {
      statAlertTyped.today = iniTIU();
    });
  }

  oneAddedToBuffer (eventName: string) {
    addOne(this.addedToBuffer, eventName);
  }

  oneSentByEmail (eventName: string) {
    addOne(this.sentByEmail, eventName);
  }

  anySavedToDb (eventName: string, mergeResult: TMergeResult) {
    const { all, byEventName } = this.savedToDb;
    let obj = byEventName[eventName];
    if (!obj) {
      byEventName[eventName] = iniTTtiu();
      obj = byEventName[eventName];
    }
    tiuPlus(all, mergeResult);
    tiuPlus(obj, mergeResult);
  }

  getDiagnostics (eventNames?: string[]): { data: { [key: string]: unknown[] }, headers: string[][] } {
    const { addedToBuffer, sentByEmail, savedToDb } = this;
    const eventNamesSet = new Set(eventNames || []);
    [addedToBuffer, sentByEmail, savedToDb].forEach((s) => {
      Object.keys(s.byEventName).forEach((v) => {
        eventNamesSet.add(v);
      });
    });
    eventNames = [...eventNamesSet].sort();
    const tiuVal = (v: any) => [v?.t || 0, v?.i || 0, v?.u || 0].join('/');
    const data: { [key: string]: unknown[] } = {
      all: [
        addedToBuffer.all.total || '',
        addedToBuffer.all.today || '',
        sentByEmail.all.total || '',
        sentByEmail.all.today || '',
        tiuVal(savedToDb.all.total || ''),
        tiuVal(savedToDb.all.today || ''),
      ],
    };
    eventNames.forEach((eventName) => {
      const b = addedToBuffer.byEventName[eventName];
      const e = sentByEmail.byEventName[eventName];
      const d = savedToDb.byEventName[eventName];
      data[eventName] = [
        b?.total || '',
        b?.today || '',
        e?.total || '',
        e?.today || '',
        tiuVal(d?.total),
        tiuVal(d?.today),
      ];
    });
    const headers: string[][] = [
      ['Added to buffer', '', 'Sent by Email', '', 'Saved to Db (t/i/u)', ''],
      ['total', 'today', 'total', 'today', 'total', 'today'],
    ];
    return { data, headers };
  }

  destroy () {
    const destroyStat = (n: string) => {
      // @ts-ignore
      const s = this[n] as any;
      delete s.all;
      Object.keys(s.byEventName).forEach((key) => {
        delete s.byEventName[key];
      });
      // @ts-ignore
      this[n] = undefined;
    };
    this.eventEmitter.removeListener('virtual-date-changed', this.callbackOnVDC);
    // @ts-ignore
    this.callbackOnVDC = undefined;
    // @ts-ignore
    this.eventEmitter = undefined;
    destroyStat('addedToBuffer');
    destroyStat('sentByEmail');
    destroyStat('savedToDb');
  }
}
