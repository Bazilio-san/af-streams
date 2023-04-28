import { ISenderConfig, IStreamConfig, TEventRecord } from '../interfaces';
import { IAlertEmailSettings, TAlert, TMergeResult } from '../alerts-buffer/i-alert';

export interface IPrepareRectifierOptions {
  /**
   * Имя свойства ts-объектов, содержащих метку времени,
   * по которому нужно производить упорядочивание внутри аккумулятора.
   * Если не передано, используется "ts"
   */
  fieldNameToSort?: string,

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
   * Время, в течение которого храним состояние отправки/сохранения сигнала
   */
  trackAlertsStateMillis?: number, // Default = MILLIS_IN_HOUR

  /**
   * Периодичность очистки кеша состояний сигналов
   */
  removeExpiredItemsFromAlertsStatesCacheIntervalMillis?: number, // Default = 60_000
}

export interface IPrepareStreamOptions {
  streamConfig: IStreamConfig,
  senderConfig: ISenderConfig,
}

export interface ISmStatisticsData {
  isSuspended: boolean,
  isStopped: boolean,
  isInitProcess: boolean,
  isShutdownProcess: boolean,
  heapUsed: number,
  rss: number,

  vt?: number,
  isCurrentTime?: boolean,

  lastSpeed?: number,
  totalSpeed?: number,

  alertsBufferLength?: number,
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
