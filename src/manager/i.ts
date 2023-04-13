import { ISenderConfig, IStreamConfig, TEventRecord } from '../interfaces';
import { IAlertEmailSettings, TAlert, TMergeResult } from '../alerts-buffer/i-alert';

export interface IPrepareRectifierOptions {
  /**
   * Периодичность отправки ts-объектов,
   * время которых старше <virtualTs> - <accumulationTimeMillis>
   */
  sendIntervalMillis?: number,

  /**
   * Имя свойства ts-объектов, содержащих метку времени,
   * по которому нужно производить упорядочивание внутри аккумулятора.
   * Если не передано, используется "ts"
   */
  fieldNameToSort?: string,

  /**
   * Время, в пределах которого происходит аккумуляция и выпрямление событий
   */
  accumulationTimeMillis?: number,

  /**
   * Callback, которому передается массив ts-объектов, упорядоченный по возрастанию
   * значения поля fieldNameToSort (или ts)
   */
  sendFunction: (_rectifierItemsArray: TEventRecord[]) => number,
}

export interface IPrepareAlertsBufferOptions {
  /**
   * Настройки для отправки E-Mail
   */
  emailSettings: IAlertEmailSettings,

  /**
   * Функция сохранения/обновления сигналов
   */
  mergeAlerts: (alerts: TAlert[]) => Promise<TMergeResult>;

  /**
   * Функция проверки наличия сохраненного сигнала в БД
   */
  checkAlertExists: (guid: string) => Promise<boolean>,

  /**
   * Функция сохранения признаков "обработан"
   */
  mergeAlertsActions: (guids: string[], operationIds: number[]) => Promise<void>

  /**
   * Время, в течение которого храним состояние отправки/сохранения сигнала
   */
  trackAlertsStateMillis?: number, // Default = MILLIS_IN_HOUR

  /**
   * Периодичность очистки кеша состояний сигналов
   */
  removeExpiredItemsFromAlertsStatesCacheIntervalMillis?: number, // Default = 60_000

  /**
   * Период вывода сигналов из буфера на отправку по Email и сохранение в БД
   */
  flushBufferIntervalSeconds?: number, // Default = 3

  /**
   * Массив идентификаторов операторов, для которых нужно устанавливать флажки - признаки новых сигналов
   */
  setFlagToProcForOperators?: number[],
}

export interface IPrepareStreamOptions {
  streamConfig: IStreamConfig,
  senderConfig: ISenderConfig,
}

export interface ISmStatisticsData {
  isSuspended: boolean,
  isStopped: boolean,
  heapUsed: number,
  rss: number,

  vt?: number,
  isCurrentTime?: boolean,

  lastSpeed?: number,
  totalSpeed?: number,

  rectifier?: {
    widthMillis: number,
    rectifierItemsCount: number,
  },
  streams?: {
    streamId: string,
    recordsetLength: number,
    isLimitExceed: boolean,
    queryDurationMillis: number,
    buf: {
      firstTs: number,
      lastTs: number,
      len: number,
    },
    rec: {
      firstTs: number,
      lastTs: number,
      len: number,
    },
  }[],
}
