/* eslint-disable no-await-in-loop */
// noinspection JSUnusedGlobalSymbols

import EventEmitter from 'events';
import { echo } from '../../utils/echo-simple';
import { Stream } from '../../Stream';

const interval = require('interval-promise');

const QUERY_QUEUE_PERIOD_DEFAULT_MILLIS = 10;

export interface ISimpleEventEmitterQueueConstructorOptions<T> {
  name: string,
  eventId: string,
  callback: (_event: T) => any,
  context: any,
  maxObjectsInQueueForLockStream: number,
  stream: Stream
  eventEmitter: EventEmitter,
  queryQueuePeriodMillis?: number,
  logger?: {
    info: (_msg: string) => void,
    error: (_msg: string | Error) => void,
  }
}

/**
 * Реализует СТРОГУЮ последовательность обработки событий, требующих заметного времени выполнения.
 * На время выполнения может быть заблокирован поток-поставщик событий (stream),
 * если в буфере накопится более заданного количества.
 *
 * Это - альтернатива обработке событий по сигналу из шины данных.
 * Т.к. обработка "предыдущего" события может затянуться (н-р, требуется обогащение персоны),
 * и обработка "последующего" события может завершиться раньше. А это не всегда то, что нужно.
 * Пример:
 *   Цепочка событий: "смена номера тел" -> "начало вывода средств" -> "продолжение вывода средств".
 *   Начинаем отслеживать события только со смены номера.
 *   Если эти первые 2 события расположены близко, случается, что и-за необходимости обогатить 2 персоны для первого события,
 *   второе "добегает" до момента принятия решения об отслеживании раньше. И выпадает.
 */
export class SimpleEventEmitterAsyncQueue<T> {
  public queue: T[] = [];

  private locked: number = 0;

  constructor (public options: ISimpleEventEmitterQueueConstructorOptions<T>) {
    const { name, eventId, queryQueuePeriodMillis } = options;
    const self = this;
    options.eventEmitter.on(eventId, (event: T) => {
      this.add2Queue(event);
      self.processQueue().then(() => 0);
    });
    interval(async () => {
      await self.processQueue();
    }, queryQueuePeriodMillis || QUERY_QUEUE_PERIOD_DEFAULT_MILLIS, { stopOnError: false });
    const msg = `Подключен слушатель событий шины '${eventId} (name: ${name}). Всего слушателей с этим id: ${options.eventEmitter.listenerCount(eventId)}`;
    if (options.logger?.info) {
      options.logger.info(msg);
    } else {
      echo(msg);
    }
  }

  add2Queue (event: T) {
    const WITH_VIRTUAL_TIME = true;
    const { queue, options } = this;
    const { stream } = options;
    queue.push(event);
    if (stream.locked) {
      stream.unLock(WITH_VIRTUAL_TIME);
    } else if (queue.length < options.maxObjectsInQueueForLockStream / 3) {
      if (queue.length >= options.maxObjectsInQueueForLockStream) {
        stream.lock(WITH_VIRTUAL_TIME);
      }
    }
  }

  async processQueue () {
    if (this.locked) {
      return;
    }
    const len = this.queue.length;
    if (!len) {
      return;
    }
    this.locked = Date.now();
    const events = this.queue.splice(0, len);
    for (let i = 0; i < events.length; i++) {
      try {
        await this.options.callback.call(this.options.context, events[i]);
      } catch (err: Error | any) {
        if (this.options.logger?.error) {
          this.options.logger.error(err);
        } else {
          echo(String(err.message || err));
        }
      }
    }
    this.locked = 0;
  }

  isLocked (): number {
    return this.locked;
  }

  destroy () {
    this.queue.splice(0, this.queue.length);
    // @ts-ignore
    this.queue = undefined;
    this.options.eventEmitter.removeAllListeners(this.options.eventId);
    // @ts-ignore
    this.options = undefined;
  }
}
