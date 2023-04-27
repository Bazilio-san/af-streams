// noinspection JSUnusedGlobalSymbols

import { lBlue, m } from 'af-color';
import { echo } from 'af-echo-ts';
import { Debug, getTimeParamFromMillis, millisTo } from 'af-tools-ts';
import { ITimeWindowItem, ITimeWindowSetStatOptions, TimeWindow } from '../base/TimeWindow';
import { MILLIS_IN_HOUR, MIN_WINDOW_MILLIS } from '../../constants';
import { VirtualTimeObj } from '../../VirtualTimeObj';
import { EWinInsertType } from '../../interfaces';

const debug = Debug('KeyedTimeWindow');

export interface IKeyedTimeWindowOptions<T, S = any> {
  /**
   * Отличительное имя окна для логирования
   */
  winName: string,
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
   * Интервал цикла удаления из хеша пустых окон
   */
  removeEmptyIntervalMillis?: number,
  /**
   * Кастомная функция для инициализации статистики ключеванных окон.
   */
  initStat?: (_timeWindow: TimeWindow<T, S>) => void,
  /**
   * Опциональная функция для записи статистики при добавлении(удалении) событий в ключеванное окно.
   * Если передана, то подменит собой метод NumberWindow.setStat()
   */
  setStat?: (_setStatOptions: ITimeWindowSetStatOptions<T, S>) => void,
  /**
   * Кастомная функция для получения статистики. Она подменит метод окна NumberWindow.getStat()
   * Если не передана, то метод this.getStatByKey() будет возвращать свойство окна NumberWindow.stat
   */
  getStat?: <ST = any>(timeWindow: TimeWindow<T, S>, ...args: any[]) => ST,
}

export interface IKeyedTimeWindowHash<T, S = any> {
  [key: string | number]: TimeWindow<T, S>
}

export interface IKeyedTimeWindowInfo {
  numberOfItemsInWindow: number,
  perHour: number,
  firstTs: number,
  lastTs: number,

  [fieldName: string]: any
}

/**
 * Набор временных окон (TimeWindow), идентифицированных ключами.
 * Ширина всех временных окон задается единым параметром this.widthMillis в момент создания ключеванного окна.
 * (впрочем это не запрещает изменение ширины отдельно взятого окна в реалтайме)
 *
 * Пример использования: для создания множества временных окон в разрезе пользователей (ключ - guid пользователя)
 * для отслеживания его сделок (и сбора статистики по ним) в пределах заданного интервала времени.
 */
export class KeyedTimeWindow<T, S = any> {
  public hash: IKeyedTimeWindowHash<T, S> = {};

  public widthMillis: number;

  _removeExpiredTimer: any;

  _collectGarbageTimer: any;

  constructor (public options: IKeyedTimeWindowOptions<T, S>) {
    this.widthMillis = options.widthMillis;
    this.setRemoveExpiredEventsTimer(options.removeExpiredIntervalMillis);
  }

  setRemoveExpiredEventsTimer (removeExpiredIntervalMillis: number | undefined) {
    const { virtualTimeObj, removeEmptyIntervalMillis } = this.options;
    const self = this;
    // Если options.removeExpiredIntervalMillis больше 0, то для очистки дочерних окон от устаревших событий
    // дополнительно используем местный метод this.removeExpired(), вызываемый по таймеру.
    // Это актуально, когда мы хотим гарантировать, что в окнах нет устаревших событий более, чем на removeExpiredIntervalMillis.
    // Дело в том, что окна очищаются по мере поступления событий. И возможен случай, когда в окне застряли устаревшие событий,
    // потому что новых событий (инициирующих очистку) не поступало.
    const isUseRemoveExpiredHere = virtualTimeObj && (removeExpiredIntervalMillis || 0) > 0;

    if (isUseRemoveExpiredHere) {
      clearInterval(this._removeExpiredTimer);
      this._removeExpiredTimer = setInterval(() => {
        const st = Date.now();
        const removedCount = self.removeExpired(virtualTimeObj.virtualTs);
        if (debug.enabled && removedCount) {
          echo(`${m}Удалено ${lBlue}${removedCount}${m} устаревших событий из окон [KeyedTimeWindow] winName: ${lBlue
          }${this.options.winName}${m} 🕒 ${Date.now() - st} ms`);
        }
      }, removeExpiredIntervalMillis || 10_000);
    } else {
      clearInterval(this._collectGarbageTimer);
      this._collectGarbageTimer = setInterval(() => {
        this.collectGarbage();
      }, removeEmptyIntervalMillis || 30_000);
    }
  }

  add (key: string | number, ts: number, data: T) {
    const { hash, widthMillis } = this;
    const item: ITimeWindowItem<T> = { ts, data };
    let timeWindow = hash[key];
    if (!timeWindow) {
      hash[key] = new TimeWindow<T, S>({
        winName: `${this.options.winName}/TW`,
        key,
        widthMillis,
        getStat: this.options.getStat,
        setStat: this.options.setStat,
        virtualTimeObj: this.options.virtualTimeObj,
        initStat: this.options.initStat,
      });
      timeWindow = hash[key];
    }
    timeWindow.add(item);
  }

  /**
   * Удаление из хеша все окна, в которых нет событий
   */
  collectGarbage () {
    Object.entries(this.hash).forEach(([key, timeWindow]) => {
      if (!timeWindow.win.length) {
        timeWindow.destroy();
        delete this.hash[key];
      }
    });
  }

  removeExpired (virtualTs: number): number {
    const { hash } = this;
    const removedFromAllTW: ITimeWindowItem<T>[] = [];
    Object.entries(hash).forEach(([key, timeWindow]) => {
      const removed = timeWindow.removeExpired(virtualTs);
      timeWindow.setStat({ timeWindow, winInsertType: EWinInsertType.REMOVE, removed });
      removedFromAllTW.push(...removed);
      if (!timeWindow.win.length) {
        delete hash[key];
      }
    });

    if (debug.enabled && removedFromAllTW.length) {
      const winWidth = getTimeParamFromMillis(this.widthMillis, 'biggest');
      echo(`${m}Удалены устаревшее события (${lBlue}${removedFromAllTW.length}${m} шт) из окна [KeyedTimeWindow] winName: ${lBlue
      }${this.options.winName}${m} (width: ${winWidth})`);
      const inputTimes = removedFromAllTW.map(({ ts }) => ts);
      const minInputTs = Math.min(...inputTimes);
      const maxInputTs = Math.max(...inputTimes);
      const minInterval = getTimeParamFromMillis(virtualTs - minInputTs, 'biggest');
      echo(`${m}\t min ts: ${lBlue}${millisTo.human.utc.z(minInputTs)}${m} / max ts: ${lBlue}${millisTo.human.utc.z(maxInputTs)}${m
      } /  vt: ${lBlue}${millisTo.human.utc.z(virtualTs)}${m} / period: ${lBlue}${minInterval}${m}`);
    }
    removedFromAllTW.forEach((timeWindowItem) => {
      timeWindowItem.data = undefined;
      // @ts-ignore
      timeWindowItem.ts = undefined;
    });
    return removedFromAllTW.length;
  }

  /**
   * Возвращает временное окно по ключу.
   */
  getWindowByKey (key: string | number): TimeWindow<T, S> | undefined {
    return this.hash[key];
  }

  getStatByKey<ST = any> (key: string | number, ...args: any[]): ST | undefined {
    const timeWindow = this.getWindowByKey(key);
    return timeWindow?.getStat(timeWindow, ...args);
  }

  getCount (key: string | number): number {
    return this.hash[key]?.win.length || 0;
  }

  /**
   * Возвращает сведения о содержимом временного окна.
   * Нужно следить за тем, чтобы метод вызывался ПОСЛЕ добавления очередной сущности в окно,
   * для того, чтобы из окна были удалены "протухшие" сущности
   */
  getInfo (key: string | number, customDataCallback?: Function): IKeyedTimeWindowInfo {
    const timeWindow = this.hash[key] || { win: [], lastTs: 0 };
    const win = timeWindow.win || [];
    const numberOfItemsInWindow = win.length;
    const result = {
      numberOfItemsInWindow,
      perHour: Math.ceil((numberOfItemsInWindow * MILLIS_IN_HOUR) / this.widthMillis),
      firstTs: numberOfItemsInWindow ? win[0].ts : 0,
      lastTs: numberOfItemsInWindow ? timeWindow.lastTs : 0,
    };
    if (customDataCallback) {
      customDataCallback(result, win);
    }
    return result;
  }

  setCountWindowWidth (widthMillis: number) {
    if (widthMillis < MIN_WINDOW_MILLIS || widthMillis === this.widthMillis) {
      return;
    }
    this.widthMillis = widthMillis;
    Object.values(this.hash).forEach((hashItem) => {
      hashItem.setWidth(widthMillis);
    });
  }

  destroy () {
    clearInterval(this._removeExpiredTimer);
    this._removeExpiredTimer = undefined;
    clearInterval(this._collectGarbageTimer);
    this._collectGarbageTimer = undefined;
    // @ts-ignore
    this.hash = undefined;
  }
}
