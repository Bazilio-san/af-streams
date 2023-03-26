/* eslint-disable no-await-in-loop */
import * as cron from 'cron';
import EventEmitter from 'events';
import { IAlertEmailSettings, TAlert, TAlertSentFlags, TMergeResult } from './i-alert';
import { AlertsStat, getAlertsStat } from './AlertsStat';
import { fillSubjectTemplate, removeHTML } from './utils/utils';
import { DEPRECATED_SEND_ALERTS_BY_EMAIL, EMAIL_SEND_RULE, EMailSendRule } from './constants';
import { IThrottleExOptions, throttleEx } from '../utils/throttle-ex';
import { getSendMail, ISendAlertArgs } from './utils/email-service';
import * as color from '../utils/color';
import { intEnv } from '../utils/utils';
import { IKeyedSingleEventTimeWindowConstructorOptions, KeyedSingleEventTimeWindow } from '../classes/keyed/KeyedSingleEventTimeWindow';
import { VirtualTimeObj } from '../VirtualTimeObj';
import { DEBUG_ALERTS_BUFFER } from '../constants';
import { IEcho, ILoggerEx } from '../interfaces';

const MILLIS_IN_HOUR = 3_600_000;

// Сигналы рассылаются пакетно. Отправляется не более этого количества писем. Остальные теряются.
const ONE_TIME_EMAIL_SEND_LIMIT = intEnv('ONE_TIME_EMAIL_SEND_LIMIT', 20);

interface IAlertsBufferConstructorOptions {
  logger: ILoggerEx,
  echo: IEcho,
  eventEmitter: EventEmitter
  virtualTimeObj: VirtualTimeObj,
  /**
   * Время, в течение которого храним состояние отправки/сохранения сигнала
   */
  trackAlertsStateMillis?: number, // Default = MILLIS_IN_DAY
  /**
   * Периодичность очистки кеша состояний сигналов
   */
  removeExpiredItemsFromAlertsStatesCacheIntervalMillis?: number, // Default = 60_000

  /**
   * Период вывода сигналов из буфера на отправку по Email и сохранение в БД
   */
  flushBufferIntervalMillis?: number, // Default = 3_000

  setFlagToProcForOperators?: number[],

  // Функция сохранения/обновления сигналов
  mergeAlerts: (alerts: TAlert[]) => Promise<TMergeResult>;

  // Функция проверки наличия сохраненного сигнала в БД
  checkAlertExists: (guid: string) => Promise<boolean>,

  // Функция сохранения признаков "обработан"
  mergeAlertsActions: (guids: string[], operationIds: number[]) => Promise<void>

  emailSettings: IAlertEmailSettings,
}

/**
 * Буфер сигналов. Сюда поступают сигналы, идентифицированные по alert.guid.
 * Если в буфере уже есть сигнал с неким alert.guid, то он будет заменен на вновь прибывший.
 * Через определенный интервал времени все сигналы из буфера сохраняется в БД (при этом буфер очищается)
 */
export class AlertsBuffer {
  public buffer: { [alertGuid: string]: { alert: TAlert, updatesCount: number } } = {};

  /**
   * Временное окно для хранения признака отправки сигнала.
   * Служит для определения - это добавление или обновление сигнала при выводе диагностики.
   * Ширина окна должна быть достаточно большой, чтобы за это время сигналы преставали обновляться.
   */
  public sentAlertsFlags: KeyedSingleEventTimeWindow<TAlertSentFlags>;

  public alertsStat: AlertsStat;

  private readonly alert2emailThrottled: (alert: TAlert) => any;

  private readonly sendMail: (options: ISendAlertArgs) => void;

  constructor (public options: IAlertsBufferConstructorOptions) {
    const { virtualTimeObj, trackAlertsStateMillis, removeExpiredItemsFromAlertsStatesCacheIntervalMillis } = options;
    const classOptions: IKeyedSingleEventTimeWindowConstructorOptions<TAlertSentFlags> = {
      winName: 'sentAlertsFlags',
      widthMillis: trackAlertsStateMillis || MILLIS_IN_HOUR,
      virtualTimeObj,
      removeExpiredIntervalMillis: removeExpiredItemsFromAlertsStatesCacheIntervalMillis || 60_000,
    };
    this.sentAlertsFlags = new KeyedSingleEventTimeWindow(classOptions);
    this.alertsStat = getAlertsStat(options.eventEmitter);

    // Дросселирование отправки писем: письма с одинаковым GUID отправляются не чаще,
    // чем 1 раз в config.email.throttleAlertsIntervalSeconds (задано 600 сек == 10 мин)
    const throttleExOption: IThrottleExOptions = {
      functionToThrottle: this.sendOneAlertToEmail.bind(this),
      intervalMills: (options.emailSettings.throttleAlertsIntervalSeconds || 600) * 1000,
      fnId: (alert: TAlert) => alert.guid,
      fnHash: undefined,
      onThrottle: undefined,
    };
    this.alert2emailThrottled = throttleEx(throttleExOption);

    this.sendMail = getSendMail(options.emailSettings, options.logger);

    this.options.flushBufferIntervalMillis = this.options.flushBufferIntervalMillis || 3_000;
    // Запуск сохранения сигналов из буфера каждые 3 секунды
    this.initCron();
  }

  markAlertAsSentByEmail (alert: TAlert) {
    alert.alertAlreadySent.byEmail = true;
    const { guid } = alert;
    const item = this.sentAlertsFlags.getItem(guid);
    if (item?.data) {
      item.data.byEmail = true;
    } else {
      this.sentAlertsFlags.add(guid, Date.now(), { toDb: false, byEmail: true });
    }
  }

  private markAlertAsSavedToDb (alert: TAlert, isSaved: boolean) {
    alert.alertAlreadySent.toDb = isSaved;
    const { guid } = alert;
    const item = this.sentAlertsFlags.getItem(guid);
    if (item?.data) {
      item.data.toDb = isSaved;
      if (isSaved) {
        item.data.noUpdateToProcForOperators = isSaved;
      }
    } else {
      this.sentAlertsFlags.add(guid, Date.now(), { toDb: isSaved, byEmail: false, noUpdateToProcForOperators: isSaved });
    }
  }

  private isAlertSavedToDb (alert: TAlert): boolean {
    return alert.alertAlreadySent.byEmail || !!this.sentAlertsFlags.getItem(alert.guid)?.data?.byEmail;
  }

  private isAlertSentByEmail (alert: TAlert): boolean {
    return alert.alertAlreadySent.toDb || !!this.sentAlertsFlags.getItem(alert.guid)?.data?.toDb;
  }

  async add (alert: TAlert): Promise<TAlert> {
    this.alertsStat.oneAddedToBuffer();
    const { guid } = alert;
    if (!guid) {
      this.options.logger.error(`Отсутствует alert.guid`);
      return alert;
    }
    if (!this.buffer[guid]) {
      this.buffer[guid] = { alert, updatesCount: 0 };
    } else {
      if (alert.updateByMe) {
        this.buffer[guid].alert = await alert.updateByMe(this.buffer[guid].alert);
      } else {
        this.buffer[guid].alert = alert;
      }
      this.buffer[guid].updatesCount++;
    }
    // Сбрасываем флаг сохранения в БД, чтобы сигнал смог обновить собой существующий в БД сигнал
    this.markAlertAsSavedToDb(alert, false);

    // Для срабатывания необходимо включить режим отладки fa:alert
    this.printDebugMessage(alert);
    return alert;
  }

  async sendOneAlertToEmail (alert: TAlert): Promise<{ to: string, info?: any, error?: any }[] | null> {
    const { logger } = this.options;
    const { guid, eventName } = alert;
    const { recipients, subjectTemplate, textHTML } = await alert.getEmail();
    const { subjectPrefix = '' } = this.options.emailSettings;
    const text = removeHTML(textHTML);
    try {
      let subject = fillSubjectTemplate(subjectPrefix + subjectTemplate, alert);
      if (process.env.NODE_ENV === 'test') {
        subject = `TEST EMAIL :: ${subject}`;
      }

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>${subject}</title>
</head>
<body>
  <pre>${textHTML}</pre>
</body>
</html>
  `;
      const fn = async (to: string): Promise<{ to: string, info?: any, error?: any }> => new Promise((resolve) => {
        const callback = (error: Error | any, info: any) => {
          const txt = `[${eventName}]:[${guid}] to <${to}>`;
          if (error) {
            logger.error(`ERROR send email alert ${txt}`);
            logger.error(error);
            resolve({ to, error });
          } else {
            logger.info(`EMAIL SENT ${txt}`);
            resolve({ to, info });
          }
        };
        this.sendMail({ to, subject, text, html, callback });
      });

      const result = await Promise.all(recipients.map(fn));
      this.alertsStat.oneSentByEmail();
      return result;
    } catch (err) {
      logger.error(err);
    }
    return null;
  }

  /**
   * Отправка пакета сигналов по EMail
   * Ограничение на количество отправляемых писем за 1 раз
   */
  async sendAlertsToEmail (alerts: TAlert[]) {
    if (DEPRECATED_SEND_ALERTS_BY_EMAIL) {
      return;
    }
    const { echo } = this.options;
    // Отфильтровываем сигналы, которые не надо отправлять по Email
    let alertsToSend: TAlert[] = [];
    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      const { guid, eventName } = alert;
      const skipMsg = `SKIP ALERT TO EMAIL ${color.lBlue}${eventName}:[${color.magenta}${guid}${color.reset}]`;
      if (this.isAlertSentByEmail(alert)) {
        if (DEBUG_ALERTS_BUFFER) {
          echo.debug(`${skipMsg}: already sent by email`);
        }
      } else if (this.isAlertSavedToDb(alert)) {
        if (DEBUG_ALERTS_BUFFER) {
          echo.debug(`${skipMsg}: already sent to DB`);
        }
      } else if (EMAIL_SEND_RULE !== EMailSendRule.FORCE && await this.options.checkAlertExists(guid)) {
        if (DEBUG_ALERTS_BUFFER) {
          echo.debug(`${skipMsg}: already present in DB`);
        }
        this.markAlertAsSavedToDb(alert, true);
      } else {
        alertsToSend.push(alert);
      }
    }

    if (alertsToSend.length > ONE_TIME_EMAIL_SEND_LIMIT) {
      this.options.logger.error(`Превышен лимит ${ONE_TIME_EMAIL_SEND_LIMIT} на одновременную отправку сигналов по E-Mali (${alertsToSend.length})`);
      alertsToSend = alertsToSend.splice(0, ONE_TIME_EMAIL_SEND_LIMIT);
    }
    alertsToSend.forEach((alert) => {
      this.markAlertAsSentByEmail(alert);
      this.alert2emailThrottled(alert);
    });
  }

  /**
   * Фильтрация сигналов, по признаку возможности сохранения в БД
   */
  async filterAllowedAlerts (alerts: TAlert[]): Promise<TAlert[]> {
    alerts = alerts.filter((alert) => !this.isAlertSavedToDb(alert));
    const allowMap = await Promise.all(alerts.map((alert) => alert.canSaveToDb()));
    return alerts.filter((_, index) => allowMap[index]);
  }

  /**
   * Группировка сигналы по eventName
   */
  static groupAlertsByEventName (alerts: TAlert[]): [string, TAlert[]][] {
    const alertsByType: { [eventName: string]: TAlert[] } = {};
    alerts.forEach((alert: TAlert) => {
      const { eventName } = alert;
      if (!alertsByType[eventName]) {
        alertsByType[eventName] = [];
      }
      alertsByType[eventName].push(alert);
    });
    return Object.entries(alertsByType);
  }

  private async saveAlertsOfTypeToDb (eventName: string, alertsOfTypeToSave: TAlert[]) {
    const newAlertsGuids = alertsOfTypeToSave
      .map(({ guid }) => guid)
      .filter((guid) => !this.sentAlertsFlags.getItemData(guid)?.noUpdateToProcForOperators);

    try {
      // MERGE
      const mergeResult = await this.options.mergeAlerts(alertsOfTypeToSave);
      // STAT
      this.alertsStat.anySavedToDb(eventName, mergeResult);
      if (DEBUG_ALERTS_BUFFER) {
        const { total, inserted, updated } = mergeResult;
        this.options.echo.debug(`${color.green}ALERTS MERGED: t/i/u: ${total}/${inserted}/${updated} / ${eventName}`);
      }

      // MARK SENT
      alertsOfTypeToSave.forEach((alert) => {
        this.markAlertAsSavedToDb(alert, true);
      });

      // Alerts Operators Actions
      if (this.options.setFlagToProcForOperators && newAlertsGuids.length) {
        await this.options.mergeAlertsActions(newAlertsGuids, this.options.setFlagToProcForOperators);
      }
    } catch (err) {
      this.options.logger.error(err);
    }
  }

  private async saveAlertsToDb (alerts: TAlert[]) {
    // Отфильтровываем сигналы, для которых отключено сохранение в БД
    const alertsFiltered = await this.filterAllowedAlerts(alerts);
    if (!alertsFiltered.length) {
      return;
    }
    // Группируем сигналы по типам
    const alertsGroupedByEventName = AlertsBuffer.groupAlertsByEventName(alertsFiltered);

    for (let i = 0; i < alertsGroupedByEventName.length; i++) {
      const [eventName, alertsOfTypeToSave] = alertsGroupedByEventName[i];
      // Сохраняем пакет сигналов одного типа
      await this.saveAlertsOfTypeToDb(eventName, alertsOfTypeToSave);
    }
  }

  private async flushBuffer () {
    const buffer = { ...this.buffer };
    this.buffer = {};
    const alerts: TAlert[] = Object.values(buffer).map(({ alert }) => alert);
    if (!alerts.length) {
      return;
    }
    // Рассылка сигналов по EMail
    this.sendAlertsToEmail(alerts).then(() => 0);
    // Сохранение сигналов в БД
    this.saveAlertsToDb(alerts).then(() => 0);
  }

  initCron () {
    const maxBusy = 5;
    let busy = 0;
    cron.job({
      cronTime: `1/${this.options.flushBufferIntervalMillis} * * * * *`,
      onTick: async () => {
        if (busy && busy <= maxBusy) {
          busy++;
          return;
        }
        if (busy > maxBusy) {
          busy = 0;
        }
        await this.flushBuffer();
        busy = 0;
      },
      start: true,
    });
  }

  printDebugMessage (alert: TAlert) {
    if (DEBUG_ALERTS_BUFFER) {
      const { red, yellow, reset: rs, magenta, lBlue, bg } = color;
      const { guid } = alert;
      const prefix = this.sentAlertsFlags.has(guid) ? `${yellow}UPDATE ` : `${red}${bg.yellow}`;
      const text = `${prefix}ALERT${rs}: ${lBlue}${alert.eventName}${rs} ${magenta}[${guid}]${rs}`;
      this.options.echo(`${text}: ${alert.getDebugMessage()}`);
    }
  }

  getDiagnostics (): string {
    const tab = (n: number = 1) => `${'    '.repeat(n)}`;
    const indent = `\n${tab()}`;
    let alertsBufferTxt = `Alerts Buffer:${indent}Length ${Object.keys(this.buffer).length}`;
    alertsBufferTxt += this.alertsStat.getDiagnostics(1);
    return alertsBufferTxt;
  }
}