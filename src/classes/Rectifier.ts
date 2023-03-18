import { findIndexOfNearestSmaller } from '../utils/find-index-of-nearest-smaller';
import { VirtualTimeObj } from '../VirtualTimeObj';

export interface IRectifierItem {
  // ts: number,
  [propName: string]: any,
}

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
  sendFunction: (rectifierItemsArray: IRectifierItem[]) => number,
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
  public accumulator: IRectifierItem[] = [];

  /**
   * Временная метка последнего ts-объекта в окне или 0, если окно пусто.
   */
  public lastTs: number = 0;

  /**
   * Время, в пределах которого происходит аккумуляция и выпрямление событий
   */
  private accumulationTimeMillis: number;

  private virtualTimeObj: VirtualTimeObj;

  private readonly sendFunction: (rectifierItemsArray: IRectifierItem[]) => number;

  private readonly fieldNameToSort: string;

  private sendTimer: any;

  constructor (public options: IRectifierOptions) {
    const { sendIntervalMillis } = options;
    this.virtualTimeObj = options.virtualTimeObj;
    this.accumulationTimeMillis = options.accumulationTimeMillis;
    this.fieldNameToSort = options.fieldNameToSort || 'ts';
    this.sendFunction = options.sendFunction;
    this.sendTimer = setInterval(() => {
      this.sendItemsFromLeft();
    }, sendIntervalMillis);
  }

  setAccumulationTimeMillis (accumulationTimeMillis: number) {
    this.accumulationTimeMillis = accumulationTimeMillis;
  }

  sendItemsFromLeft (): number {
    const { accumulator, fieldNameToSort } = this;
    const index = findIndexOfNearestSmaller(accumulator, this.virtualTimeObj.virtualTs - this.accumulationTimeMillis, fieldNameToSort);
    if (index > -1) {
      const toSend = accumulator.splice(0, index + 1);
      const { length } = accumulator;
      this.lastTs = length ? accumulator[length - 1][fieldNameToSort] : 0;
      return this.sendFunction(toSend);
    }
    return 0;
  }

  add (item: IRectifierItem): void {
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
    clearInterval(this.sendTimer);
    this.sendTimer = undefined;
    // @ts-ignore
    this.accumulator = undefined;
  }
}
