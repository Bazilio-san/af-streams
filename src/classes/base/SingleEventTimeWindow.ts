/* eslint-disable no-use-before-define */
import { m } from 'af-color';
import { echo } from 'af-echo-ts';
import { Debug } from 'af-tools-ts';
import { ITimeWindowItem } from './TimeWindow';
import { MIN_WINDOW_MILLIS } from '../../constants';
import { VirtualTimeObj } from '../../VirtualTimeObj';
import { toUTC } from '../../utils/date-utils';

const debug = Debug('SingleEventTimeWindow');

export interface ISingleEventTimeWindowSetStatOptions<T, S> {
  singleEventTimeWindow: SingleEventTimeWindow<T, S>,
  added?: ITimeWindowItem<T>,
  removed?: ITimeWindowItem<T>,
}

export interface ISingleEventTimeWindowConstructorOptions<T, S = any> {
  /**
   * Имя окна для логирования
   */
  winName: string,
  /**
   * Ключ окна, когда оно используется в объекте KeyedSingleEventTimeWindow
   */
  key?: string | number,
  /**
   * Ширина окна, мс
   */
  widthMillis: number,
  /**
   * Окно работает на основе "виртуального" времени, что важно в режиме тестирования на исторических данных.
   * Хотя этот параметр используется только для вычисления времени устаревания событий в окне, в функции this.removeExpired()
   */
  virtualTimeObj?: VirtualTimeObj,
  /**
   * Периодичность очистки окна от устаревших событий.
   * Если 0, то очистка происходит при добавлении каждого события
   * Если undefined, то очистка не производится (этим управляет вышестоящий объект)
   */
  removeExpiredIntervalMillis?: number,
  /**
   * Опциональная функция для инициализации статистики.
   */
  initStat?: (_arg: SingleEventTimeWindow<T, S>) => void,
  /**
   * Опциональная функция для записи статистики добавления/удаления событий в окно.
   * Если передана, то подменит собой метод this.setStat()
   */
  setStat?: (_arg: ISingleEventTimeWindowSetStatOptions<T, S>) => void,
  /**
   * Кастомная функция для получения статистики. Она подменит метод окна this.getStat()
   * Если не передана, то метод this.getStat() будет возвращать свойство окна stat
   */
  getStat?: (_arg: SingleEventTimeWindow<T, S>) => any,
  /**
   * Опциональная кастомная функция добавления сведений из поступившего события в свойство this.event.
   * Если не передана, то новое событие просто заменяет свойство this.event.
   *
   * Эта функция полезна, когда мы хотим хранить состояние в свойстве this.event.data и не просто заменять на новое,
   * а внедрять данные из нового в уже имеющийся объект
   */
  assignData?: (_instance: SingleEventTimeWindow<T, S>, _event: ITimeWindowItem<T>) => any,
}

/**
 * ВРЕМЕНН́ОЕ ОКНО для ОДНОГО элемента.
 * События обязаны содержать метку времени.
 *
 * События поступают в окно с помощью метода this.add() и обновляют последнее событие - свойство this.event
 * После того, как событие устареет, оно удаляется (this.event = null)
 * Удаление устаревшего события происходит методом this.removeExpired() который вызывается:
 * - либо периодически, через заданный интервал "this.removeExpiredIntervalMillis"
 * - либо при каждом новом событии (если this.removeExpiredIntervalMillis = 0)
 * - либо контролируется вышестоящим объектом (если this.removeExpiredIntervalMillis = undefined)
 */
export class SingleEventTimeWindow<T, S = any> {
  /**
   * Ширина окна, мс
   */
  public widthMillis: number;

  /**
   * Единственный объект живущий во временном окне
   */
  public item: ITimeWindowItem<T> | undefined;

  /**
   * Либо временная метка последнего события в окне.
   * Либо, в случае, когда передан virtualTimeObj и очистка окна происходит периодически на основе виртуального времени,
   * в этом свойстве хранится время последней очистки. Это позволяет более точно контролировать процесс очистки устаревши событий.
   */
  public lastTs: number = 0;

  /**
   * Время в окне, левее которого событие устаревает.
   */
  public expireTs: number = 0;

  /**
   * Флаг, устанавливаемый при создании экземпляра класса
   * и определяющий режим работы очистки окна от устаревшего события:
   * Если true - очистка производится при поступлении каждого нового события, опираясь на его временную метку.
   * Если false - очистка будет производиться периодически, опираясь на виртуальное время (или контролируется вышестоящим объектом).
   */
  public readonly removeExpiredOnEveryEvents: boolean = false;

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
  public setStat: (_arg: ISingleEventTimeWindowSetStatOptions<T, S>) => void;

  /**
   * Метод класса, возвращающий статистику. По умолчанию возвращает свойство класса this.stat.
   * Но если при создании экземпляра класса в опциях передано свойство getStat (функция),
   * оно замещает метод класса this.getStat и управление передается этой кастомной функции.
   */
  public getStat: (_arg?: SingleEventTimeWindow<T, S>) => any;

  /**
   * Время поступления первого события в окно. Устанавливается единожды.
   */
  public inputTs: number = 0;

  _removeExpiredTimer: any;

  constructor (public options: ISingleEventTimeWindowConstructorOptions<T, S>) {
    const { virtualTimeObj, getStat } = options;
    const self = this;
    options.winName = options.winName || '?';
    options.key = options.key || '?';
    this.widthMillis = options.widthMillis;

    // ----------------- stat ------------------
    this.stat = undefined as unknown as S;
    if (typeof options.initStat === 'function') {
      options.initStat(this);
    }
    this.setStat = options.setStat || (() => null);
    this.getStat = getStat ? () => getStat(this) : () => this.stat;
    // ------------------------------------------

    if (virtualTimeObj && options.removeExpiredIntervalMillis) {
      clearInterval(this._removeExpiredTimer);
      this._removeExpiredTimer = setInterval(() => {
        self.removeExpired(virtualTimeObj.virtualTs);
      }, options.removeExpiredIntervalMillis);
    } else {
      this.removeExpiredOnEveryEvents = options.removeExpiredIntervalMillis !== undefined;
    }
  }

  setExpireTs (_by?: string) {
    // Если поступит очень старое событие, оно не должно сдвинуть в прошлое время устаревания
    this.expireTs = Math.max(this.expireTs, this.lastTs - this.widthMillis);
  }

  /**
   * Удаление устаревшего события
   * Функция вызывается
   * 1) либо при поступлении очередного события, опираясь на его метку времени,
   * 2) либо по таймауту, опираясь на виртуальное время.
   * 3) либо вызывается вышестоящим объектом.
   *    Например, в коллекции именованных временных окон можно периодически совершать
   *    обход окон и совершать очистку устаревших событий из них.
   * Режим работы определяется наличием опции virtualTimeObj и значением опции removeExpiredIntervalMillis
   * при создании экземпляра класса.
   * Если есть virtualTimeObj и removeExpiredIntervalMillis > 0 запускается режим 2.
   * Если removeExpiredIntervalMillis = undefined запускается режим 3.
   */
  removeExpired (virtualTs?: number): ITimeWindowItem<T> | undefined {
    if (virtualTs) {
      this.lastTs = virtualTs;
      this.setExpireTs('virtualTs');
    }
    const { item, expireTs } = this;
    if (item && item.ts < expireTs) {
      this.item = undefined;
      if (debug.enabled && this.options.removeExpiredIntervalMillis !== undefined) {
        echo(`${m}Удалено устаревшее событие из окна [SingleEventTimeWindow] winName: ${this.options.winName
        } / key: ${this.options.key} / -> ${toUTC(this.inputTs)} - ${toUTC(this.lastTs)} ->`);
      }
      this.setStat({ singleEventTimeWindow: this, removed: item });
      return item;
    }
  }

  /**
   * Добавление нового события в окно
   *
   * Новое событие будет внедрено в свойство this.item.
   * В простейшем случае, когда не передана опция-функция assignData,
   * this.item будет заменено на новое событие.
   * В общем случае, с помощью assignData() данные нового события внедряются в this.item.data
   *
   * Тут же:
   * - выставляются свойства this.lastTs и this.expireTs
   * - вызывается метод this.setStat()
   * - вызывается метод this.removeExpired(), если взведен флаг removeExpiredOnEveryEvents.
   * Возвращает только что добавленное событие или null.
   */
  add (item: ITimeWindowItem<T>, noChangeTs?: boolean): ITimeWindowItem<T> | undefined {
    if (!item) {
      return undefined;
    }
    const { ts } = item;

    if (ts < this.expireTs) {
      this.setStat({ singleEventTimeWindow: this, removed: item });
    } else {
      if (!noChangeTs) {
        this.lastTs = Math.max(ts, this.item?.ts || 0);
      }
      if (!this.inputTs) {
        this.inputTs = ts;
      }
      if (this.options.assignData) {
        this.options.assignData(this, item);
      } else {
        this.item = item;
      }
      this.setStat({ singleEventTimeWindow: this, added: item });
    }
    this.setExpireTs('item');
    // Здесь может быть случай, когда новое событие сразу же устарело.
    // Тога оно будет штатно удалено при следующей очистке.
    if (this.removeExpiredOnEveryEvents) {
      this.removeExpired();
    }
    return this.item;
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
    this.setExpireTs('setWidth');
    if (isShrink) {
      this.removeExpired();
    }
  }

  destroy () {
    clearInterval(this._removeExpiredTimer);
    this._removeExpiredTimer = undefined;
    this.item = undefined;
    this.stat = undefined as unknown as S;
    // @ts-ignore
    this.setStat = undefined;
    // @ts-ignore
    this.getStat = undefined;
  }
}
