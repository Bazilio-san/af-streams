/* eslint-disable no-await-in-loop */
import EventEmitter from 'events';
import {
  bg, green, lBlue, magenta, red, reset, rs, yellow,
} from 'af-color';
import { fillBracketTemplate, IThrottleExOptions, removeHTML, throttleEx } from 'af-tools-ts';
import { IAlertEmailSettings, TAlert, TAlertSentFlags, TMergeResult } from './i-alert';
import { AlertsStat } from './AlertsStat';
import { alertEmailFooter, alertEmailHeader, fillHtmlTemplate, jsonToHtml } from './lib/utils';
import { getSendMail, ISendAlertArgs } from './lib/email-service';
import { IKeyedSingleEventTimeWindowConstructorOptions, KeyedSingleEventTimeWindow } from '../classes/keyed/KeyedSingleEventTimeWindow';
import { VirtualTimeObj } from '../VirtualTimeObj';
import { EMailSendRule, PARAMS } from '../params';
import { DEBUG_ALERTS_BUFFER } from '../constants';
import { IEcho, ILoggerEx } from '../interfaces';

const MILLIS_IN_HOUR = 3_600_000;

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

  // Функция сохранения/обновления сигналов
  mergeAlerts: (alerts: TAlert[]) => Promise<TMergeResult>;

  // Функция проверки наличия сохраненного сигнала в БД
  checkAlertExists: (guid: string) => Promise<boolean>,

  emailSettings: IAlertEmailSettings,

  // Базовая часть ссылок на сигналы в стандартных письмах
  linkBase?: string,
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

  private alert2emailThrottled: (alert: TAlert) => any;

  private sendMail: (options: ISendAlertArgs) => void;

  private _loopTimer: any;

  private busy: number = 0;

  private _locked: boolean = false;

  constructor (public options: IAlertsBufferConstructorOptions) {
    const { virtualTimeObj, trackAlertsStateMillis, removeExpiredItemsFromAlertsStatesCacheIntervalMillis } = options;
    const classOptions: IKeyedSingleEventTimeWindowConstructorOptions<TAlertSentFlags> = {
      winName: 'sentAlertsFlags',
      widthMillis: trackAlertsStateMillis || MILLIS_IN_HOUR,
      virtualTimeObj,
      removeExpiredIntervalMillis: removeExpiredItemsFromAlertsStatesCacheIntervalMillis || 60_000,
    };
    this.sentAlertsFlags = new KeyedSingleEventTimeWindow(classOptions);
    this.alertsStat = new AlertsStat(options.eventEmitter);

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

    // Запуск сохранения сигналов из буфера каждые 3 секунды
    this.loop().then(() => 0);
  }

  markAlertAsSentByEmail (alert: TAlert) {
    if (!alert.alertAlreadySent) {
      alert.alertAlreadySent = {};
    }
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
    if (!alert.alertAlreadySent) {
      alert.alertAlreadySent = {};
    }
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
    return alert.alertAlreadySent?.byEmail || !!this.sentAlertsFlags.getItem(alert.guid)?.data?.byEmail;
  }

  private isAlertSentByEmail (alert: TAlert): boolean {
    return alert.alertAlreadySent?.toDb || !!this.sentAlertsFlags.getItem(alert.guid)?.data?.toDb;
  }

  async add (alert: TAlert): Promise<TAlert> {
    if (this._locked) {
      return alert;
    }
    const { guid } = alert;
    if (!guid) {
      this.options.logger.error(`Отсутствует alert.guid`);
      return alert;
    }
    this.alertsStat.oneAddedToBuffer(alert.eventName);
    if (!alert.alertAlreadySent) {
      alert.alertAlreadySent = {};
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
    // Для срабатывания необходимо включить режим отладки fa:alert. Печать диагностики необходимо вызвать до установки флагов отправки.
    this.printDebugMessage(alert);

    // Сбрасываем флаг сохранения в БД, чтобы сигнал смог обновить собой существующий в БД сигнал
    this.markAlertAsSavedToDb(alert, false);
    return alert;
  }

  async sendOneAlertToEmail (alert: TAlert): Promise<{ to: string, info?: any, error?: any }[] | null> {
    const { logger, linkBase } = this.options;
    const { guid, eventName } = alert;
    const getEmailResult = await alert.getEmail();
    const { recipients } = getEmailResult;
    let { subjectTemplate, htmlBody } = getEmailResult;
    if (!subjectTemplate) {
      // заголовок письма по умолчанию
      subjectTemplate = `Alert [{eventName}]`;
    }

    if (!htmlBody) {
      // Тело письма по умолчанию - весь сигнал в виде форматированного json
      htmlBody = alertEmailHeader({ alert, wrapPre: true })
        + jsonToHtml(alert)
        + alertEmailFooter({ alert, wrapPre: true, linkBase });
    }

    const { subjectPrefix = '' } = this.options.emailSettings;
    const text = removeHTML(htmlBody);
    try {
      let subject = fillBracketTemplate(subjectPrefix + subjectTemplate, alert);
      if (process.env.NODE_ENV === 'test') {
        subject = `TEST EMAIL :: ${subject}`;
      }
      const html = fillHtmlTemplate({ body: htmlBody, title: subject });
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
      this.alertsStat?.oneSentByEmail(alert.eventName);
      return result;
    } catch (err) {
      logger.error(err);
    }
    return null;
  }

  /**
   * Фильтрация сигналов, по признаку возможности отправки по Email
   */
  async filterAlertsAllowedSendByEmail (alerts: TAlert[]): Promise<TAlert[]> {
    if (PARAMS.emailSendRule === EMailSendRule.BLOCK) {
      return [];
    }

    const { echo } = this.options;
    // Отфильтровываем сигналы, которые не надо отправлять по Email
    const alertsToSend: TAlert[] = [];
    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      const { guid, eventName } = alert;
      const skipMsg = `SKIP ALERT TO EMAIL ${lBlue}${eventName}:[${magenta}${guid}${reset}]`;
      if (this.isAlertSentByEmail(alert)) {
        if (DEBUG_ALERTS_BUFFER) {
          echo.debug(`${skipMsg}: already sent by email`);
        }
      } else if (this.isAlertSavedToDb(alert)) {
        if (DEBUG_ALERTS_BUFFER) {
          echo.debug(`${skipMsg}: already sent to DB`);
        }
      } else if (PARAMS.emailSendRule !== EMailSendRule.FORCE && await this.options.checkAlertExists(guid)) {
        if (DEBUG_ALERTS_BUFFER) {
          echo.debug(`${skipMsg}: already present in DB`);
        }
        this.markAlertAsSavedToDb(alert, true);
      } else {
        alertsToSend.push(alert);
      }
    }

    const allowedSendByEmailMap = await Promise.all(alerts.map((alert) => {
      if (!alert.canSendByEmail) {
        return true;
      }
      return alert.canSendByEmail();
    }));
    return alertsToSend.filter((_, index) => allowedSendByEmailMap[index]);
  }

  /**
   * Отправка пакета сигналов по EMail
   * Ограничение на количество отправляемых писем за 1 раз
   */
  async sendAlertsToEmail (alerts: TAlert[]) {
    let alertsToSend = await this.filterAlertsAllowedSendByEmail(alerts);
    if (!alertsToSend) {
      return;
    }
    const limit = PARAMS.emailOneTimeSendLimit;
    if (alertsToSend.length > limit) {
      this.options.logger.error(`Превышен лимит ${limit} на одновременную отправку сигналов по E-Mali (${alertsToSend.length})`);
      alertsToSend = alertsToSend.splice(0, limit);
    }
    alertsToSend.forEach((alert) => {
      this.markAlertAsSentByEmail(alert);
      this.alert2emailThrottled(alert);
    });
  }

  /**
   * Фильтрация сигналов, по признаку возможности сохранения в БД
   */
  async filterAlertsAllowedSaveToDb (alerts: TAlert[]): Promise<TAlert[]> {
    alerts = alerts.filter((alert) => !this.isAlertSavedToDb(alert));
    const allowedSaveToDbMap = await Promise.all(alerts.map((alert) => {
      if (!alert.canSaveToDb) {
        return true;
      }
      return alert.canSaveToDb();
    }));
    return alerts.filter((_, index) => allowedSaveToDbMap[index]);
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
    try {
      // MERGE
      const mergeResult = await this.options.mergeAlerts(alertsOfTypeToSave);
      // STAT
      this.alertsStat?.anySavedToDb(eventName, mergeResult);
      if (DEBUG_ALERTS_BUFFER) {
        const { total, inserted, updated } = mergeResult;
        this.options.echo.debug(`${green}ALERTS MERGED: t/i/u: ${total}/${inserted}/${updated} / ${eventName}`);
      }

      // MARK SENT
      alertsOfTypeToSave.forEach((alert) => {
        this.markAlertAsSavedToDb(alert, true);
      });
    } catch (err) {
      this.options.logger.error(err);
    }
  }

  private async saveAlertsToDb (alerts: TAlert[]) {
    // Отфильтровываем сигналы, для которых отключено сохранение в БД
    const alertsFiltered = await this.filterAlertsAllowedSaveToDb(alerts);
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

  async flushBuffer (awaitSend?: boolean): Promise<number> {
    const buffer = { ...this.buffer };
    this.buffer = {};
    const alerts: TAlert[] = Object.values(buffer).map(({ alert }) => alert);
    const { length } = alerts;
    if (!length) {
      return 0;
    }
    const promise = Promise.all([
      this.sendAlertsToEmail(alerts),
      this.saveAlertsToDb(alerts),
    ]);
    if (awaitSend) {
      await promise;
    }
    return length;
  }

  async loop () {
    clearTimeout(this._loopTimer);
    const maxBusy = 5;
    if (this.busy && this.busy <= maxBusy) {
      this.busy++;
      return;
    }
    if (this.busy > maxBusy) {
      this.busy = 0;
    }
    try {
      await this.flushBuffer();
    } catch (err: any) {
      this.options.logger.error(err);
      return;
    }
    this.busy = 0;
    const self = this;
    this._loopTimer = setTimeout(() => {
      self.loop();
    }, (PARAMS.flushAlertsBufferIntervalSec) * 1000);
  }

  printDebugMessage (alert: TAlert) {
    if (DEBUG_ALERTS_BUFFER) {
      const { guid } = alert;
      const prefix = this.sentAlertsFlags.has(guid) ? `${yellow}UPDATE ` : `${red}${bg.yellow}`;
      const text = `${prefix}ALERT${rs}: ${lBlue}${alert.eventName}${rs} ${magenta}[${guid}]${rs}`;
      const msg = typeof alert.getDebugMessage === 'function' ? alert.getDebugMessage() : '';
      this.options.echo(`${text}${msg ? `: ${msg}` : ''}`);
    }
  }

  getDiagnostics (eventNames?: string[]): { data: { [key: string]: unknown[] }, headers: string[][] } {
    return this.alertsStat.getDiagnostics(eventNames);
  }

  get length (): number {
    return Object.keys(this.buffer).length;
  }

  lock () {
    this._locked = true;
    clearTimeout(this._loopTimer);
  }

  destroy () {
    clearTimeout(this._loopTimer);
    // @ts-ignore
    this.buffer = undefined;
    this.sentAlertsFlags.destroy();
    // @ts-ignore
    this.sentAlertsFlags = undefined;
    this.alertsStat.destroy();
    // @ts-ignore
    this.alertsStat = undefined;
    // @ts-ignore
    this.alert2emailThrottled = undefined;
    // @ts-ignore
    this.sendMail = undefined;
    this.options.echo.warn('DESTROYED: [AlertsBuffer]');
  }
}
