/* eslint-disable no-use-before-define */

import { EWinInsertType } from '../../interfaces';
import { findIndexOfNearestSmaller } from '../../utils/find-index-of-nearest-smaller';

export interface INumberWindowItem<T> {
  ts: number,
  data: T,
}

export interface INumberWindowSetStatOptions<T> {
  numberWindow: NumberWindow<T>,
  winInsertType: EWinInsertType,
  added?: INumberWindowItem<T>,
  removed?: INumberWindowItem<T>[],
}

export interface INumberWindowConstructorOptions<T> {
  /**
   * Отличительное имя окна для логирования
   */
  winName: string,
  /**
   * Ключ окна, когда оно используется в объекте KeyedTimeWindow
   */
  key?: string | number,
  /**
   * Ширина окна: максимальное количество элементов в окне
   */
  width: number,
  /**
   * Опциональная функция для записи статистики при добавлении(удалении) событий в окно.
   * Если передана, то подменит собой метод this.setStat()
   */
  setStat?: (_arg: INumberWindowSetStatOptions<T>) => void,
  /**
   * Кастомная функция для получения статистики. Она подменит метод окна this.getStat()
   * Если не передана, то метод this.getStat() будет возвращать свойство окна stat
   */
  getStat?: <ST = any>(numberWindow: NumberWindow<T>, ...args: any[]) => ST,
  /**
   * Первое событие, которое можно передать в момент создания экземпляра класса.
   * Это может быть удобно, когда окна создаются по мере поступления событий определенного класса.
   */
  item?: INumberWindowItem<T>
}

/**
 * Количественное окно, в котором события располагаются в порядке их временных меток,
 * но, при этом, если в окне более this.width событий, самые левые выбывают из окна.
 *
 * Пример применения: хотим подсчитывать среднюю цену для НЕ БОЛЕЕ, ЧЕМ 1000 ценовых событий.
 * Тогда установим this.width = 1000, а INumberWindowItem параметризуем ценой (INumberWindowItem<number>)
 */
export class NumberWindow<T> {
  public win: INumberWindowItem<T>[] = [];

  public lastTs: number = 0;

  /**
   * Ширина окна: максимальное количество элементов в окне
   */
  public width: number = 1;

  /**
   * Место хранения статистики. Заполнение этого свойства должно быть описано самостоятельно, в функции setStat,
   * передаваемой в опциях при создании экземпляра класса
   */
  public stat: any;

  /**
   * Метод класса, заполняющий статистику. По умолчанию не делает ничего. Но если при создании экземпляра класса
   * в опциях передано свойство setStat (функция), оно замещает метод класса и управление заполнением статистики
   * передается этой кастомной функции.
   */
  public setStat: (_setStatOptions: INumberWindowSetStatOptions<T>) => void;

  /**
   * Метод класса, возвращающий статистику. По умолчанию возвращает свойство класса this.stat.
   * Но если при создании экземпляра класса в опциях передано свойство getStat (функция),
   * оно замещает метод класса this.getStat и управление передается этой кастомной функции.
   */
  public getStat: <ST = any> (numberWindow: NumberWindow<T>, ...args: any[]) => ST;

  constructor (options: INumberWindowConstructorOptions<T>) {
    const { width, setStat, getStat, item } = options;
    options.winName = options.winName || '?';
    options.key = options.key || '?';
    this.width = width;
    this.setStat = setStat || (() => null);
    this.getStat = getStat ? (numberWindow: NumberWindow<T>, ...args: any[]) => getStat(numberWindow, ...args) : () => this.stat;
    if (item) {
      this.add(item);
    }
  }

  add (item: INumberWindowItem<T>): void {
    const { ts } = item;
    const { win, width } = this;
    if (!win.length) {
      win.push(item);
      this.lastTs = ts;
      this.setStat({ numberWindow: this, winInsertType: EWinInsertType.FIRST, added: item });
      return;
    }

    if (ts <= win[0].ts) {
      if (win.length < width) {
        win.unshift(item);
        this.setStat({ numberWindow: this, winInsertType: EWinInsertType.LEFT, added: item });
      }
      // Если окно уже заполнено (win.length = width), то новое событие, расположенное по времени левее левого, не добавляется в окно
      return;
    }

    if (this.lastTs <= ts) {
      // Новое событие, расположенное по времени правее правого, - добавляем.
      // И удаляем из окна те, что слева, если в окне событий больше width
      win.push(item);
      let removed: INumberWindowItem<T>[] | undefined;
      if (win.length > width) {
        removed = win.splice(0, win.length - width);
      }
      this.lastTs = ts;
      this.setStat({ numberWindow: this, winInsertType: EWinInsertType.RIGHT, added: item, removed });
      return;
    }

    // Новое событие, расположенное по времени где-то между левым и правым крайноми, - добавляем.
    // И удаляем из окна те, что слева, если в окне событий больше width
    const index = findIndexOfNearestSmaller(win, ts, 'ts');
    if (index === -1) {
      throw new Error(`Ошибка при поиске места для ${ts} в "числовом" окне: ${win.map(({ ts: t }: any) => t).join(',')}`);
    }
    win.splice(index + 1, 0, item);
    this.lastTs = win[win.length - 1].ts;
    const removed = win.length > width ? win.splice(0, win.length - width) : undefined;
    this.setStat({ numberWindow: this, winInsertType: EWinInsertType.MIDDLE, added: item, removed });
  }

  setWidth (width: number) {
    if (width < 1 || width === this.width) {
      return;
    }
    const isShrink = this.width > width;
    this.width = width;
    if (isShrink) {
      const { win } = this;
      const numberOfElementsToRemove = win.length - width;
      if (numberOfElementsToRemove > 0) {
        const removed = win.splice(0, numberOfElementsToRemove);
        this.setStat({ numberWindow: this, winInsertType: EWinInsertType.REMOVE, removed });
      }
    }
  }

  destroy () {
    // @ts-ignore
    this.win = undefined;
    this.stat = undefined;
    // @ts-ignore
    this.setStat = undefined;
    // @ts-ignore
    this.getStat = undefined;
  }
}
