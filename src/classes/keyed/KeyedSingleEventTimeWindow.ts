// noinspection JSUnusedGlobalSymbols

import { ISingleEventTimeWindowConstructorOptions, SingleEventTimeWindow } from '../base/SingleEventTimeWindow';
import { ITimeWindowItem } from '../base/TimeWindow';
import { MIN_WINDOW_MILLIS, PRINT_EVERY_REMOVED_ITEM_FROM_KEYED_SINGLE_EVENT_TIME_WINDOW } from '../../constants';
import { lBlue, g, m, rs } from '../../utils/color';
import { toUTC } from '../../utils/date-utils';
import { Debug } from '../../utils/debug';
import { echoSimple } from '../../utils/echo-simple';
import { getTimeParamFromMillis, padR } from '../../utils/utils';

const debug = Debug('KeyedSingleEventTimeWindow');

const REMOVE_EMPTY_INTERVAL_DEFAULT = 60_000;

export interface IKeyedSingleEventTimeWindowConstructorOptions<T> extends Omit<ISingleEventTimeWindowConstructorOptions<T>, 'item'> {
  // Отличительное имя (ID) экземпляра класса. Для логирования.
  // Вместе с ключом, дает уникальные идентификаторы для окон, хранящихся в хеше.
  winName: string,
  // widthMillis: number,
  // virtualTimeObj: VirtualTimeObj,
  removeEmptyIntervalMillis?: number,
  // removeExpiredIntervalMillis?: number,
  // setStat?: (arg: ITimeWindowSetStatOptions<T>) => void,
  // getStat?: (arg: TimeWindow<T>) => any,
  assignData?: (_instance: SingleEventTimeWindow<T>, _event: ITimeWindowItem<T>) => void,
}

export class KeyedSingleEventTimeWindow<T> {
  // Хеш, где под ключами хранятся окна с единичными, самыми последними событиями одного типа.
  // По мере устаревания событий в своих окнах (и освобождения окон), записи так же удаляются и из хеша.
  public hash: { [key: string]: SingleEventTimeWindow<T> } = {};

  // Место для хранения дополнительных сведений.
  public data: any = {};

  // Шаблон опций, передаваемых в конструктор временного окна (Изменчив только параметр winName)
  private windowOptionsTemplate: ISingleEventTimeWindowConstructorOptions<T>;

  private removeExpiredTimer: any;

  private collectGarbageTimer: any;

  constructor (public options: IKeyedSingleEventTimeWindowConstructorOptions<T>) {
    const { removeEmptyIntervalMillis = REMOVE_EMPTY_INTERVAL_DEFAULT } = options;
    const { winName, virtualTimeObj, widthMillis, setStat, getStat, removeExpiredIntervalMillis, assignData } = this.options;
    const isUseRemoveExpiredHere = virtualTimeObj && (removeExpiredIntervalMillis || 0) > 0;

    this.windowOptionsTemplate = {
      winName: `${winName}/template`,
      widthMillis,
      virtualTimeObj,
      setStat,
      getStat,
      // Если options.removeExpiredIntervalMillis больше 0, то отключаем механизм удаления устаревших событий у объектов
      // SingleEventTimeWindow и используем местный таймер для очистки дочерних окон
      removeExpiredIntervalMillis: isUseRemoveExpiredHere ? undefined : 0,
      assignData,
    };
    if (isUseRemoveExpiredHere) {
      const self = this;
      this.removeExpiredTimer = setInterval(() => {
        self.removeExpired(virtualTimeObj.virtualTs);
      }, removeExpiredIntervalMillis);
    } else {
      this.collectGarbageTimer = setInterval(() => {
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
        ...this.windowOptionsTemplate,
        winName: `SETW/${this.options.winName}/${key}`,
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
  getWindowByKey (key: string): SingleEventTimeWindow<T> | undefined {
    return this.hash[key];
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
      echoSimple(`${m}Удалено ${lBlue}${removed.length}${m} устаревших событий из окон [KeyedSingleEventTimeWindow] winName: ${lBlue
      }${this.options.winName}`);
      const padLen = Math.max(...removed.map(([key]) => key.length)) + 2;
      if (PRINT_EVERY_REMOVED_ITEM_FROM_KEYED_SINGLE_EVENT_TIME_WINDOW) {
        removed.forEach(([key, hashItem]) => {
          const { inputTs: inp, lastTs: lst } = hashItem;
          const distance = getTimeParamFromMillis(lst - inp, 'biggest');
          echoSimple(`${m}\t - key: ${lBlue}${padR(key, padLen)}${rs} / in ${m}${toUTC(inp)}${rs} out ${m}${toUTC(lst)}${rs} / ${g}${distance}`);
        });
      } else {
        const inputTimes = removed.map(([, hashItem]) => hashItem.inputTs);
        const minInputTs = Math.min(...inputTimes);
        const maxInputTs = Math.max(...inputTimes);
        const minInterval = getTimeParamFromMillis(virtualTs - minInputTs, 'biggest');
        echoSimple(`${m}\t min ts: ${lBlue}${toUTC(minInputTs)}${m} / max ts: ${lBlue}${toUTC(maxInputTs)}${m
        } /  vt: ${lBlue}${toUTC(virtualTs)}${m} / period: ${lBlue}${minInterval}${m}`);
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
    clearInterval(this.removeExpiredTimer);
    this.removeExpiredTimer = undefined;
    clearInterval(this.collectGarbageTimer);
    this.collectGarbageTimer = undefined;
    // @ts-ignore
    this.hash = undefined;
    this.data = undefined;
    // @ts-ignore
    this.windowOptionsTemplate = undefined;
  }
}
