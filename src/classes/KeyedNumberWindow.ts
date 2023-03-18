// noinspection JSUnusedGlobalSymbols

import { INumberWindowItem, INumberWindowSetStatOptions, NumberWindow } from './base/NumberWindow';
import { toUTC } from '../utils/date-utils';
import { Debug } from '../utils/debug';
import { echo } from '../utils/echo-simple';
import { lBlue, m } from '../utils/color';
import { VirtualTimeObj } from '../VirtualTimeObj';
import { getTimeParamFromMillis } from '../utils/utils';

const debug = Debug('KeyedNumberWindow');

export interface IKeyedNumberWindowHash<T> {
  [key: string]: NumberWindow<T>
}

export interface IKeyedNumberWindowOptions<T> {
  /**
   * Отличительное имя окна для логирования
   */
  winName: string,
  /**
   * Ширина окна: максимальное количество элементов в окне
   */
  width: number,
  /**
   * Опциональная функция для записи статистики при добавлении(удалении) событий в ключеванное окно.
   * Если передана, то подменит собой метод NumberWindow.setStat()
   */
  setStat?: (setStatOptions: INumberWindowSetStatOptions<T>) => void,
  /**
   * Кастомная функция для получения статистики. Она подменит метод окна NumberWindow.getStat()
   * Если не передана, то метод this.getStatByKey() будет возвращать свойство окна NumberWindow.stat
   */
  getStat?: (numberWindow: NumberWindow<T>) => any,

  /**
   * Параметры удаления устаревших окон и событий в них.
   *
   * Два варианта использования числового окна:
   * 1) В окнах всегда остается не более width событий
   * 2) Окна устаревают, когда самое последнее событие в них становится старше maxLiveTimeOfNumberEventsMillis
   */
  garbageCollection?: {
    /**
     * Максимальное время жизни последнего события в окне, после которого окно считается устаревшим и удаляется.
     */
    maxLiveTimeOfNumberEventsMillis: number,
    /**
     * Интервал цикла очистки устаревших окон.
     */
    intervalMillis: number,
    /**
     * Если передан virtualTimeObj, то время устаревания будет рассчитываться
     * от VirtualTimeObj.virtualTs, иначе - от Date.now()
     */
    virtualTimeObj?: VirtualTimeObj,
  },
}

/**
 * Набор количественных окон (NumberWindow), идентифицированных ключами.
 * Ширина всех окон задается единым параметром this.width в момент создания ключеванного окна.
 * (впрочем это не запрещает изменение ширины отдельно взятого окна в реалтайме)
 *
 * Пример использования: для создания множества количественных окон в разрезе инструментов (ключ - instrument.id)
 * для отслеживания средней цены в пределах (не более чем) заданного количества ценовых событий (н-р, сделок).
 */
export class KeyedNumberWindow<T> {
  public hash: IKeyedNumberWindowHash<T> = {};

  /**
   * Ширина окна: максимальное количество элементов в ключеванном окне
   */
  public width: number;

  private collectGarbageTimer: any;

  constructor (public options: IKeyedNumberWindowOptions<T>) {
    const { width, garbageCollection } = options;
    this.width = width;
    if (garbageCollection) {
      this.setCollectGarbageTimer(garbageCollection.intervalMillis);
    }
  }

  setCollectGarbageTimer (collectGarbageIntervalMillis: number) {
    clearInterval(this.collectGarbageTimer);
    this.collectGarbageTimer = setInterval(() => {
      this.collectGarbage();
    }, collectGarbageIntervalMillis);
  }

  add (key: string | number, ts: number, data: T): void {
    const { hash } = this;
    const item: INumberWindowItem<T> = { ts, data };
    const numberWindow = hash[key];
    if (!numberWindow) {
      const { setStat, getStat } = this.options;
      hash[key] = new NumberWindow<T>({
        winName: `NW/${this.options.winName}/${key}`,
        width: this.width,
        setStat,
        getStat,
        item,
      });
      return;
    }
    hash[key].add(item);
  }

  /**
   * Удаление из окон событий, которые живут более maxLiveTimeOfNumberEventsMillis.
   * Удаление из хеша всех окон, в которых нет событий
   */
  collectGarbage () {
    if (!this.options.garbageCollection) {
      return;
    }
    let removedWindowsCount = 0;
    let maxTs = 0;
    const { maxLiveTimeOfNumberEventsMillis, virtualTimeObj } = this.options.garbageCollection;
    const virtualTs = virtualTimeObj?.virtualTs || Date.now();
    const expireTs = virtualTs - maxLiveTimeOfNumberEventsMillis;
    Object.entries(this.hash).forEach(([key, numberWindow]) => {
      if (maxLiveTimeOfNumberEventsMillis) {
        if (numberWindow.lastTs < expireTs) {
          removedWindowsCount++;
          maxTs = Math.max(maxTs, ...numberWindow.win.map(({ ts }) => ts));
          numberWindow.destroy();
          delete this.hash[key];
        }
      } else if (!numberWindow.win.length) {
        removedWindowsCount++;
        delete this.hash[key];
      }
    });

    if (debug.enabled && removedWindowsCount) {
      echo(`${m}Удалено ${lBlue}${removedWindowsCount}${m} опустевших окон [KeyedNumberWindow] winName: ${lBlue
      }${this.options.winName}`);
      if (maxTs) {
        const minInterval = getTimeParamFromMillis(virtualTs - maxTs, 'biggest');
        echo(`${m}\t max ts: ${lBlue}${toUTC(maxTs)}${m} /  vt: ${lBlue}${toUTC(virtualTs)}${m} / period: ${lBlue}${minInterval}${m}`);
      }
    }

    return removedWindowsCount;
  }

  /**
   * Возвращает окно по ключу.
   */
  getWindowByKey (key: string | number): NumberWindow<T> | undefined {
    return this.hash[key];
  }

  getStatByKey (key: number): number {
    const numberWindow = this.getWindowByKey(key);
    return numberWindow?.getStat(numberWindow);
  }

  setWidth (width: number) {
    if (width < 1 || width === this.width) {
      return;
    }
    this.width = width;
    Object.values(this.hash).forEach((numberWindow) => {
      numberWindow.setWidth(width);
    });
  }

  destroy () {
    clearInterval(this.collectGarbageTimer);
    this.collectGarbageTimer = undefined;
    // @ts-ignore
    this.hash = undefined;
  }
}