// noinspection JSUnusedGlobalSymbols

import { clearInterval } from 'timers';
import { echo } from 'af-echo-ts';
import { findIndexOfNearestSmaller } from '../../utils/find-index-of-nearest-smaller';
import { VirtualTimeObj } from '../../VirtualTimeObj';
import { TEventRecord } from '../../interfaces';
import { PARAMS } from '../../params';

export interface IRectifierOptions {
  virtualTimeObj: VirtualTimeObj,
  /**
   * Имя свойства ts-объектов, содержащих метку времени,
   * по которому нужно производить упорядочивание внутри аккумулятора.
   * Если не передано, используется "ts"
   */
  fieldNameToSort?: string,

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
 * Периодически <PARAMS.rectifierSendIntervalMillis> отбираются все объекты,
 * которые старше виртуального времени на <PARAMS.rectifierAccumulationTimeMillis>
 * и передаются в функцию <this.sendFunction>
 *
 * Т.о. жертвуя оперативностью на время <PARAMS.rectifierAccumulationTimeMillis>
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
    this.fieldNameToSort = options.fieldNameToSort || 'ts';
    this.sendFunction = options.sendFunction;
    this.resetRectifierSendInterval();
  }

  // ####################################  SET  ################################
  resetRectifierSendInterval () {
    clearInterval(this._sendTimer);
    this._sendTimer = setInterval(() => {
      this.sendItemsFromLeft();
    }, PARAMS.rectifierSendIntervalMillis);
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

  sendItemsFromLeft (): number {
    const { accumulator, fieldNameToSort, virtualTimeObj } = this;
    const index = findIndexOfNearestSmaller(accumulator, virtualTimeObj.virtualTs - PARAMS.rectifierAccumulationTimeMillis, fieldNameToSort);
    if (index > -1) {
      const toSend = accumulator.splice(0, index + 1);
      const { length } = accumulator;
      this.lastTs = length ? accumulator[length - 1][fieldNameToSort] : 0;
      return this.sendFunction(toSend);
    }
    return 0;
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
    echo.warn('DESTROYED: [Rectifier]');
  }
}
