// noinspection JSUnusedGlobalSymbols

import { lBlue, g, m, rs } from 'af-color';
import { echo } from 'af-echo-ts';
import { Debug, DebugExact, getTimeParamFromMillis, millisTo, padR } from 'af-tools-ts';
import { ISingleEventTimeWindowConstructorOptions, SingleEventTimeWindow } from '../base/SingleEventTimeWindow';
import { ITimeWindowItem } from '../base/TimeWindow';
import { MIN_WINDOW_MILLIS } from '../../constants';

const debug = Debug('KeyedSingleEventTimeWindow');
const debugExact = DebugExact('printEveryRemovedItemFromKeyedSingleEventTimeWindow');

const REMOVE_EMPTY_INTERVAL_DEFAULT = 60_000;

export interface IKeyedSingleEventTimeWindowConstructorOptions<T, S = any> extends Omit<ISingleEventTimeWindowConstructorOptions<T, S>, 'item'> {
  // Отличительное имя (ID) экземпляра класса. Для логирования.
  // Вместе с ключом, дает уникальные идентификаторы для окон, хранящихся в хеше.
  winName: string,
  // widthMillis: number,
  // virtualTimeObj: VirtualTimeObj,
  removeEmptyIntervalMillis?: number,
  // removeExpiredIntervalMillis?: number,
  // setStat?: (arg: ITimeWindowSetStatOptions<T>) => void,
  // getStat?: (arg: TimeWindow<T>) => any,
  assignData?: (_instance: SingleEventTimeWindow<T, S>, _event: ITimeWindowItem<T>) => void,
}

export class KeyedSingleEventTimeWindow<T, S = any> {
  // Хеш, где под ключами хранятся окна с единичными, самыми последними событиями одного типа.
  // По мере устаревания событий в своих окнах (и освобождения окон), записи так же удаляются и из хеша.
  public hash: { [key: string]: SingleEventTimeWindow<T, S> } = {};

  // Место для хранения дополнительных сведений.
  public data: any = {};

  // Шаблон опций, передаваемых в конструктор временного окна (Изменчив только параметр winName)
  _windowOptionsTemplate: ISingleEventTimeWindowConstructorOptions<T, S>;

  _removeExpiredTimer: any;

  _collectGarbageTimer: any;

  constructor (public options: IKeyedSingleEventTimeWindowConstructorOptions<T, S>) {
    const { removeEmptyIntervalMillis = REMOVE_EMPTY_INTERVAL_DEFAULT } = options;
    const {
      winName, virtualTimeObj, widthMillis, setStat, getStat, initStat, removeExpiredIntervalMillis, assignData,
    } = this.options;
    const isUseRemoveExpiredHere = virtualTimeObj && (removeExpiredIntervalMillis || 0) > 0;

    this._windowOptionsTemplate = {
      winName: `${winName}/template`,
      widthMillis,
      virtualTimeObj,
      initStat,
      setStat,
      getStat,
      // Если options.removeExpiredIntervalMillis больше 0, то отключаем механизм удаления устаревших событий у объектов
      // SingleEventTimeWindow и используем местный таймер для очистки дочерних окон
      removeExpiredIntervalMillis: isUseRemoveExpiredHere ? undefined : 0,
      assignData,
    };
    if (isUseRemoveExpiredHere) {
      const self = this;
      this._removeExpiredTimer = setInterval(() => {
        self.removeExpired(virtualTimeObj.virtualTs);
      }, removeExpiredIntervalMillis);
    } else {
      this._collectGarbageTimer = setInterval(() => {
        this.collectGarbage();
      }, removeEmptyIntervalMillis);
    }
  }

  /**
   * Добавляет событие по ключу в соответствующее временное окно.
   * Возвращает только что добавленное событие или null.
   */
  add (key: string, ts: number, data: T, noChangeTs?: boolean): ITimeWindowItem<T> | undefined {
    const { hash } = this;
    let timeWindow = hash[key];
    if (!timeWindow) {
      hash[key] = new SingleEventTimeWindow({
        ...this._windowOptionsTemplate,
        winName: `${this.options.winName}/SETW`,
        key,
      });
      timeWindow = hash[key];
      noChangeTs = false;
    }
    const item: ITimeWindowItem<T> = { ts, data };
    return timeWindow.add(item, noChangeTs);
  }

  /**
   * Удаление из хеша всех окон, в которых нет событий
   */
  collectGarbage () {
    Object.entries(this.hash).forEach(([key, singleEventTimeWindow]) => {
      if (!singleEventTimeWindow.item) {
        singleEventTimeWindow.destroy();
        delete this.hash[key];
      }
    });
  }

  /**
   * Возвращает временное окно по ключу.
   */
  getWindowByKey (key: string): SingleEventTimeWindow<T, S> | undefined {
    return this.hash[key];
  }

  getStatByKey (key: string): any {
    const singleEventTimeWindow = this.getWindowByKey(key);
    return singleEventTimeWindow?.getStat(singleEventTimeWindow);
  }

  /**
   * Возвращает элемент item {ts, dsta} из временного окна по ключу.
   */
  getItem (key: string): ITimeWindowItem<T> | undefined {
    return this.hash[key]?.item;
  }

  /**
   * Возвращает данные события из временного окна по ключу.
   * Если нет окна, или в нем нет события, вернет undefined
   * Нужно следить за тем, чтобы метод вызывался ПОСЛЕ добавления очередного события в окно,
   * для того, чтобы из окна были удалены "протухшие" события
   */
  getItemData (key: string): T | undefined {
    return this.hash[key]?.item?.data;
  }

  /**
   * Динамическое изменение ширины временных окон.
   */
  setWidth (widthMillis: number) {
    const { options } = this;
    if (widthMillis < MIN_WINDOW_MILLIS || widthMillis === options.widthMillis) {
      return;
    }
    options.widthMillis = widthMillis;
    Object.values(this.hash).forEach((hashItem) => {
      hashItem.setWidth(widthMillis);
    });
  }

  /**
   * Удаление устаревших событий из окон
   */
  removeExpired (virtualTs: number): number {
    const removed = Object.entries(this.hash).filter(([, hashItem]) => hashItem.removeExpired(virtualTs));
    if (debug.enabled && removed.length) {
      echo(`${m}Удалено ${lBlue}${removed.length}${m} устаревших событий из окон [KeyedSingleEventTimeWindow] winName: ${lBlue
      }${this.options.winName}`);
      const padLen = Math.max(...removed.map(([key]) => key.length)) + 2;
      if (debugExact.enabled) {
        removed.forEach(([key, hashItem]) => {
          const { inputTs: inp, lastTs: lst } = hashItem;
          const distance = getTimeParamFromMillis(lst - inp, 'biggest');
          echo(`${m}\t - key: ${lBlue}${padR(key, padLen)}${rs} / in ${m}${millisTo.human.utc.z(inp)}${rs} out ${m}${millisTo.human.utc.z(lst)}${rs} / ${g}${distance}`);
        });
      } else {
        const inputTimes = removed.map(([, hashItem]) => hashItem.inputTs);
        const minInputTs = Math.min(...inputTimes);
        const maxInputTs = Math.max(...inputTimes);
        const minInterval = getTimeParamFromMillis(virtualTs - minInputTs, 'biggest');
        echo(`${m}\t min ts: ${lBlue}${millisTo.human.utc.z(minInputTs)}${m} / max ts: ${lBlue}${millisTo.human.utc.z(maxInputTs)}${m
        } /  vt: ${lBlue}${millisTo.human.utc.z(virtualTs)}${m} / period: ${lBlue}${minInterval}${m}`);
      }
    }
    removed.forEach(([key, hashItem]) => {
      hashItem.destroy();
      delete this.hash[key];
    });
    return removed.length;
  }

  has (key: string): boolean {
    return !!this.getItemData(key);
  }

  /**
   * Удаление события из отслеживания
   */
  delete (key: string): void {
    const singleEventTimeWindow = this.getWindowByKey(key);
    if (singleEventTimeWindow) {
      singleEventTimeWindow.destroy();
    }
    delete this.hash[key];
  }

  destroy () {
    clearInterval(this._removeExpiredTimer);
    this._removeExpiredTimer = undefined;
    clearInterval(this._collectGarbageTimer);
    this._collectGarbageTimer = undefined;
    // @ts-ignore
    this.hash = undefined;
    this.data = undefined;
    // @ts-ignore
    this._windowOptionsTemplate = undefined;
  }
}
