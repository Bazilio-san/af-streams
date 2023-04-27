/* eslint-disable no-use-before-define */
// noinspection JSUnusedGlobalSymbols

import { lBlue, m } from 'af-color';
import { echo } from 'af-echo-ts';
import { Debug } from 'af-tools-ts';
import { MIN_WINDOW_MILLIS } from '../../constants';
import { EWinInsertType } from '../../interfaces';
import { findIndexOfNearestSmaller } from '../../utils/find-index-of-nearest-smaller';
import { VirtualTimeObj } from '../../VirtualTimeObj';

const debug = Debug('TimeWindow');

export interface ITimeWindowItem<T> {
  ts: number,
  data?: T,
}

export interface ITimeWindowSetStatOptions<T, S = any> {
  timeWindow: TimeWindow<T, S>,
  winInsertType: EWinInsertType,
  added?: ITimeWindowItem<T>,
  removed?: ITimeWindowItem<T>[],
}

export interface ITimeWindowConstructorOptions<T, S = any> {
  /**
   * Отличительное имя окна для логирования
   */
  winName: string,
  /**
   * Ключ окна, когда оно используется в объекте KeyedTimeWindow
   */
  key?: string | number,
  /**
   * Ширина окна, мс
   */
  widthMillis: number,
  /**
   * Окно работает на основе "виртуального" времени, что важно в режиме тестирования на исторических данных.
   * Используется только для вычисления времени устаревания событий в окне, в функции this.removeExpired()
   */
  virtualTimeObj?: VirtualTimeObj,
  /**
   * Периодичность очистки окна от устаревших событий.
   * Если 0, то очистка происходит при добавлении каждого события
   */
  removeExpiredIntervalMillis?: number,
  /**
   * Кастомная функция для инициализации статистики.
   */
  initStat?: (_timeWindow: TimeWindow<T, S>) => void,
  /**
   * Опциональная функция для записи статистики при добавлении(удалении) событий в окно.
   * Если передана, то подменит собой метод this.setStat()
   */
  setStat?: (_setStatOptions: ITimeWindowSetStatOptions<T, S>) => void,
  /**
   * Кастомная функция для получения статистики. Она подменит метод окна this.getStat()
   * Если не передана, то метод this.getStat() будет возвращать свойство окна stat
   */
  getStat?: <ST = any>(timeWindow: TimeWindow<T, S>, ...args: any[]) => ST,
  /**
   * Первое событие, которое можно передать в момент создания экземпляра класса.
   * Это может быть удобно, когда окна создаются по мере поступления событий определенного класса.
   */
  item?: ITimeWindowItem<T>,
}

/**
 * ВРЕМЕННОЕ́ ОКНО для множества событий одного типа.
 * События обязаны содержать метку времени.
 * Они поступают в окно с помощью метода add() и выбывают (при вызове метода this.removeExpired())
 * после того, как устареют (когда их метка времени сдвинется вправо за границу окна)
 *
 * Метод this.removeExpired(), удаляющий события, оказавшиеся за пределами окна (слева)
 * вызывается либо периодически, через заданный интервал "this.removeExpiredIntervalMillis",
 * либо при каждом новом событии (если this.removeExpiredIntervalMillis не задан)
 */
export class TimeWindow<T, S = any> {
  /**
   * Собственно - ОКНО - упорядоченный по времени массив событий
   */
  public win: ITimeWindowItem<T>[] = [];

  /**
   * Либо временная метка последнего события в окне.
   * Либо, в случае, когда передан virtualTimeObj и очистка окна происходит периодически на основе виртуального времени,
   * в этом свойстве хранится время последней очистки. Это позволяет более точно контролировать процесс очистки устаревши событий.
   */
  public lastTs: number = 0;

  /**
   * expireTs - время в окне, левее которого события устарели.
   * Используется для быстрого поиска индекса первого устаревшего события
   * с помощью функции findIndexOfNearestSmaller()
   */
  public expireTs: number = 0;

  /**
   * Ширина окна, мс
   */
  public widthMillis: number;

  /**
   * Флаг, устанавливаемый при создании экземпляра класса
   * и определяющий режим работы очистки окна от устаревших событий:
   * Если true - очистка производится при поступлении каждого нового события, опираясь на его временную метку.
   * Если false - очистка будет производиться периодически, опираясь на виртуальное время.
   * (В последнем случае, значит, гарантировано были переданы virtualTimeObj и ненулевой параметр removeExpiredIntervalMillis)
   */
  public readonly removeExpiredOnEveryEvents: boolean;

  /**
   * Место хранения статистики. Заполнение этого свойства должно быть описано самостоятельно, в функции setStat,
   * передаваемой в опциях при создании экземпляра класса
   */
  public stat: S;

  /**
   * Метод класса, заполняющий статистику. По умолчанию не делает ничего. Но если при создании экземпляра класса
   * в опциях передано свойство setStat (функция), оно замещает метод класса и управление заполнением статистики
   * передается этой кастомной функции.
   */
  public setStat: (_arg: ITimeWindowSetStatOptions<T, S>) => void;

  /**
   * Метод класса, возвращающий статистику. По умолчанию возвращает свойство класса this.stat.
   * Но если при создании экземпляра класса в опциях передано свойство getStat (функция),
   * оно замещает метод класса this.getStat и управление передается этой кастомной функции.
   */
  public getStat: <ST = any>(timeWindow: TimeWindow<T, S>, ...args: any[]) => ST;

  _removeExpiredTimer: any;

  constructor (public options: ITimeWindowConstructorOptions<T, S>) {
    const { widthMillis, virtualTimeObj, getStat, item, removeExpiredIntervalMillis = 0 } = options;
    this.widthMillis = widthMillis;
    this.removeExpiredOnEveryEvents = !(virtualTimeObj && removeExpiredIntervalMillis);

    options.winName = options.winName || '?';
    options.key = options.key || '?';

    // ----------------- stat ------------------
    this.stat = undefined as unknown as S;
    if (typeof options.initStat === 'function') {
      options.initStat(this);
    }
    this.setStat = options.setStat || (() => null);
    this.getStat = getStat ? (timeWindow: TimeWindow<T, S>, ...args: any[]) => getStat(timeWindow, ...args) : () => this.stat as any;
    // ------------------------------------------

    if (item) {
      this.add(item);
    }
    const self = this;
    if (!this.removeExpiredOnEveryEvents) {
      clearInterval(this._removeExpiredTimer);
      this._removeExpiredTimer = setInterval(() => {
        const st = Date.now();
        const removedCount = self.removeExpired((virtualTimeObj as VirtualTimeObj).virtualTs).length;
        if (debug.enabled && removedCount) {
          echo(`${m}Удалено ${lBlue}${removedCount}${m
          } устаревших событий из окна [TimeWindow] winName: ${this.options.winName} / key: ${this.options.key}  🕒 ${Date.now() - st} ms`);
        }
      }, removeExpiredIntervalMillis);
    }
  }

  /**
   * Удаление (устаревших) элементов окна, оказавшихся за пределами левой границы.
   * Функция вызывается
   * 1) либо при поступлении очередного события, опираясь на его метку времени,
   * 2) либо по таймауту, опираясь на виртуальное время.
   * Режим работы определяется наличием опции virtualTimeObj и значением опции removeExpiredIntervalMillis
   * при создании экземпляра класса. Если есть virtualTimeObj и removeExpiredIntervalMillis > 0 запускается режим 2.
   * Кроме этого метод может вызываться извне. Например, в коллекции именованных временных окон можно периодически совершать
   * обход окон и совершать очистку устаревших событий из них.
   */
  removeExpired (virtualTs?: number, destructureIt: boolean = false): ITimeWindowItem<T>[] {
    if (virtualTs) {
      this.lastTs = virtualTs;
      this.expireTs = virtualTs - this.widthMillis; // Почему -widthMillis см. примечание к свойству expireTs
    }
    const index = findIndexOfNearestSmaller(this.win, this.expireTs + 1, 'ts');
    if (index > -1) {
      const removed = this.win.splice(0, index + 1);
      if (destructureIt) {
        removed.forEach((timeWindowItem) => {
          timeWindowItem.data = undefined;
        });
      }
      return removed;
    }
    return [];
  }

  /**
   * Добавление нового события в окно
   *
   * Новое событие добавляется с помощью метода this.add() в окно НА СВОЕ МЕСТО
   * (его временная метка будет не меньше события слева и не больше события справа)
   * Тут же:
   * - выставляются свойства this.lastTs и this.expireTs
   * - вызывается метод this.setStat()
   * - вызывается метод this.removeExpired(), если взведен флаг this.removeExpiredOnEveryEvents.
   * Возвращает только что добавленное событие или null.
   */
  add (item: ITimeWindowItem<T>): ITimeWindowItem<T> | null {
    const { ts } = item;
    const { win, widthMillis } = this;
    if (!win.length) {
      win.push(item);
      // Если поступит очень старое событие, оно не должно сдвинуть в прошлое lastTs
      this.lastTs = ts;
      const expireTs = ts - widthMillis; // Все события старше последнего на ширину окна - устаревают
      // Если поступит очень старое событие, оно не должно сдвинуть в прошлое время устаревания
      this.expireTs = Math.max(this.expireTs, expireTs);
      this.setStat({ timeWindow: this, winInsertType: EWinInsertType.FIRST, added: item, removed: [] });
      return item;
    }
    if (ts < this.expireTs) {
      // В статистику скидываем даже те события, которые уже устарели, не успев поступить
      this.setStat({ timeWindow: this, winInsertType: EWinInsertType.REMOVE, added: item, removed: [item] });
      return null;
    }
    let winInsertType: EWinInsertType;
    // Здесь в окне есть события! Т.к. выполнено !!this.win.length выше. Значит this.lastTs относится к последнему событию
    // (К вопросу о том, может ли здесь this.lastTs быть просто временем последней очистки, установленным в this.removeExpired? - НЕТ!)
    if (ts > this.lastTs) {
      win.push(item);
      this.lastTs = ts;
      this.expireTs = ts - widthMillis; // Все события старше последнего на ширину окна - устаревают
      winInsertType = EWinInsertType.RIGHT;
    } else {
      const insertIndex = findIndexOfNearestSmaller(win, ts, 'ts');
      if (insertIndex > -1) {
        win.splice(insertIndex + 1, 0, item);
        winInsertType = EWinInsertType.MIDDLE;
      } else {
        win.unshift(item);
        winInsertType = EWinInsertType.LEFT;
      }
    }
    // Здесь может быть случай, когда новое событие сразу же устарело.
    // Тога оно будет штатно удалено при следующей очистке.
    const removed = this.removeExpiredOnEveryEvents ? this.removeExpired() : [];
    this.setStat({ timeWindow: this, winInsertType, added: item, removed });
    return item;
  }

  /**
   * Динамическое изменение ширины окна.
   * Сразу же вызывается метод удаления устаревших событий.
   */
  setWidth (widthMillis: number) {
    if (widthMillis < MIN_WINDOW_MILLIS || widthMillis === this.widthMillis) {
      return;
    }
    const isShrink = this.widthMillis > widthMillis;
    this.widthMillis = widthMillis;
    this.expireTs = this.lastTs - widthMillis; // Все события старше последнего на ширину окна - устаревают
    if (isShrink) {
      this.removeExpired();
    }
  }

  /**
   * очистка временного окна
   */
  clear () {
    this.win = [];
    this.lastTs = 0;
    this.expireTs = 0;
  }

  destroy () {
    clearInterval(this._removeExpiredTimer);
    this._removeExpiredTimer = undefined;
    // @ts-ignore
    this.win = undefined;
    this.stat = undefined as unknown as S;
    // @ts-ignore
    this.setStat = undefined;
    // @ts-ignore
    this.getStat = undefined;
  }
}
