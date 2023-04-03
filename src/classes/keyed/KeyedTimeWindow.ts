// noinspection JSUnusedGlobalSymbols

import { ITimeWindowItem, ITimeWindowSetStatOptions, TimeWindow } from '../base/TimeWindow';
import { echoSimple } from '../../utils/echo-simple';
import { MILLIS_IN_HOUR, MIN_WINDOW_MILLIS } from '../../constants';
import { Debug } from '../../utils/debug';
import { lBlue, m } from '../../utils/color';
import { toUTC } from '../../utils/date-utils';
import { VirtualTimeObj } from '../../VirtualTimeObj';
import { getTimeParamFromMillis } from '../../utils/utils';

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
  getStat?: (_timeWindow: TimeWindow<T, S>) => any,
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
          echoSimple(`${m}Удалено ${lBlue}${removedCount}${m} устаревших событий из окон [KeyedTimeWindow] winName: ${lBlue
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
    const removed: ITimeWindowItem<T>[] = [];
    Object.entries(hash).forEach(([key, timeWindow]) => {
      removed.push(...timeWindow.removeExpired(virtualTs));
      if (!timeWindow.win.length) {
        delete hash[key];
      }
    });

    if (debug.enabled && removed.length) {
      const winWidth = getTimeParamFromMillis(this.widthMillis, 'biggest');
      echoSimple(`${m}Удалены устаревшее события (${lBlue}${removed.length}${m} шт) из окна [KeyedTimeWindow] winName: ${lBlue
      }${this.options.winName}${m} (width: ${winWidth})`);
      const inputTimes = removed.map(({ ts }) => ts);
      const minInputTs = Math.min(...inputTimes);
      const maxInputTs = Math.max(...inputTimes);
      const minInterval = getTimeParamFromMillis(virtualTs - minInputTs, 'biggest');
      echoSimple(`${m}\t min ts: ${lBlue}${toUTC(minInputTs)}${m} / max ts: ${lBlue}${toUTC(maxInputTs)}${m
      } /  vt: ${lBlue}${toUTC(virtualTs)}${m} / period: ${lBlue}${minInterval}${m}`);
    }
    removed.forEach((timeWindowItem) => {
      timeWindowItem.data = undefined;
      // @ts-ignore
      timeWindowItem.ts = undefined;
    });
    return removed.length;
  }

  /**
   * Возвращает временное окно по ключу.
   */
  getWindowByKey (key: string | number): TimeWindow<T, S> | undefined {
    return this.hash[key];
  }

  getStatByKey (key: string | number): any {
    const timeWindow = this.getWindowByKey(key);
    return timeWindow?.getStat(timeWindow);
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
