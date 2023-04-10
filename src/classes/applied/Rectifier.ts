// noinspection JSUnusedGlobalSymbols

import { clearInterval } from 'timers';
import { findIndexOfNearestSmaller } from '../../utils/find-index-of-nearest-smaller';
import { VirtualTimeObj } from '../../VirtualTimeObj';
import { TEventRecord } from '../../interfaces';
import { DEFAULTS } from '../../constants';
import { intEnv } from '../../utils/utils';
import { echoSimple } from '../../utils/echo-simple';

export interface IRectifierOptions {
  virtualTimeObj: VirtualTimeObj,

  /**
   * Периодичность отправки ts-объектов,
   * время которых старше <virtualTs> - <accumulationTimeMillis>
   */
  sendIntervalMillis: number,

  /**
   * Имя свойства ts-объектов, содержащих метку времени,
   * по которому нужно производить упорядочивание внутри аккумулятора.
   * Если не передано, используется "ts"
   */
  fieldNameToSort?: string,

  /**
   * Время, в пределах которого происходит аккумуляция и выпрямление событий
   */
  accumulationTimeMillis: number,

  /**
   * Callback, которому передается массив ts-объектов, упорядоченный по возрастанию
   * значения поля fieldNameToSort (или ts)
   */
  sendFunction: (_rectifierItemsArray: TEventRecord[]) => number,
}

/**
 * Класс "Выпрямитель". Служит для упорядочивания событий, которые, имея метку времени своего рождения,
 * тем не менее могут поступать в хаотическом порядке.
 *
 * Вновь поступающие объекты расставляются в массиве-аккумуляторе по возрастанию
 * значения поля <this.fieldNameToSort>,
 * Периодически <options.sendIntervalMillis> отбираются все объекты,
 * которые старше виртуального времени на <this.accumulationTimeMillis>
 * и передаются в функцию <this.sendFunction>
 *
 * Т.о. жертвуя оперативностью на время <this.accumulationTimeMillis>
 * мы получаем восстановленную хронологию событий.
 */
export class Rectifier {
  /**
   * Упорядоченный по времени массив ts-объектов
   */
  public accumulator: TEventRecord[] = [];

  /**
   * Временная метка последнего ts-объекта в окне или 0, если окно пусто.
   */
  public lastTs: number = 0;

  virtualTimeObj: VirtualTimeObj;

  sendFunction: (_eventRecordsArray: TEventRecord[]) => number;

  readonly fieldNameToSort: string;

  _sendTimer: any;

  constructor (public options: IRectifierOptions) {
    this.virtualTimeObj = options.virtualTimeObj;
    this.setAccumulationTimeMillis();
    this.fieldNameToSort = options.fieldNameToSort || DEFAULTS.RECTIFIER_FIELD_NAME_TO_SORT;
    this.sendFunction = options.sendFunction;
    this.setSendIntervalMillis();
  }

  setAccumulationTimeMillis (value?: number) {
    this.options.accumulationTimeMillis = (value && Number(value))
      || Number(this.options.accumulationTimeMillis)
      || intEnv('RECTIFIER_ACCUMULATION_TIME_MILLIS', DEFAULTS.RECTIFIER_ACCUMULATION_TIME_MILLIS); // Default 300_000;
  }

  setSendIntervalMillis (value?: number) {
    value = (value && Number(value))
      || Number(this.options.sendIntervalMillis)
      || intEnv('RECTIFIER_SEND_INTERVAL_MILLIS', DEFAULTS.RECTIFIER_SEND_INTERVAL_MILLIS); // 10 ms
    this.options.sendIntervalMillis = value;
    clearInterval(this._sendTimer);
    this._sendTimer = setInterval(() => {
      this.sendItemsFromLeft();
    }, this.options.sendIntervalMillis);
  }

  sendItemsFromLeft (): number {
    const { accumulator, fieldNameToSort } = this;
    const index = findIndexOfNearestSmaller(accumulator, this.virtualTimeObj.virtualTs - this.options.accumulationTimeMillis, fieldNameToSort);
    if (index > -1) {
      const toSend = accumulator.splice(0, index + 1);
      const { length } = accumulator;
      this.lastTs = length ? accumulator[length - 1][fieldNameToSort] : 0;
      return this.sendFunction(toSend);
    }
    return 0;
  }

  add (item: TEventRecord): void {
    const { accumulator, fieldNameToSort } = this;
    const ts = item[fieldNameToSort];
    if (!accumulator.length) {
      accumulator.push(item);
      return;
    }
    // Здесь в окне есть события! Т.к. выполнено !!this.win.length выше. Значит this.lastTs относится к последнему событию
    // (К вопросу о том, может ли здесь this.lastTs быть просто временем последней очистки, установленным в this.removeExpired? - НЕТ!)
    if (ts > this.lastTs) {
      accumulator.push(item);
      this.lastTs = ts;
      return;
    }
    const insertIndex = findIndexOfNearestSmaller(accumulator, ts, fieldNameToSort);
    if (insertIndex > -1) {
      accumulator.splice(insertIndex + 1, 0, item);
    } else {
      accumulator.unshift(item);
    }
  }

  /**
   * очистка временного окна
   */
  clear () {
    this.accumulator = [];
    this.lastTs = 0;
  }

  destroy () {
    clearInterval(this._sendTimer);
    this._sendTimer = undefined;
    // @ts-ignore
    this.accumulator = undefined;
    // @ts-ignore
    this.virtualTimeObj = undefined;
    // @ts-ignore
    this.sendFunction = undefined;
    echoSimple.warn('DESTROYED: [Rectifier]');
  }
}
