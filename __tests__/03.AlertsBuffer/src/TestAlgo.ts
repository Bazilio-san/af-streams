import { AlertsBuffer, TAlert } from '../../../src';

export interface ITestAlgoConstructorOptions {
  eventName: string,
  alertsBuffer: AlertsBuffer,
}

export interface ITestEvent {
  ts: number,
  guid: string,
  threshold: boolean,
  can_save_to_db: boolean,
  value: number,
  saved_to_db: boolean,
  sent_to_email: boolean,
}

export class TestAlgo {
  private alertsBuffer: AlertsBuffer | null = null;

  private readonly eventName: string = '';

  constructor (public options: ITestAlgoConstructorOptions) {
    this.eventName = options.eventName;
    this.alertsBuffer = options.alertsBuffer;
  }

  prepareAlertAndSend = async (event: ITestEvent): Promise<TAlert> => {
    const { ts, guid } = event;
    const alert: TAlert = {
      guid,
      alertTypeId: 1,
      ts,
      info_json: { ...event },
      eventName: this.eventName,
      // Подготавливает шаблон заголовка и тело письма (HTML) для отправки уведомления по email
      async getEmail () {
        const recipients = ['vvmakarov@corp.finam.ru'];
        const subjectTemplate = 'SUBJ';
        const textHTML = JSON.stringify(event);
        return { recipients, subjectTemplate, textHTML };
      },
      // Подготавливает ключевые сведения о сигнале для вывода в консоль в режиме отладки
      getDebugMessage () {
        return `debugMessage: ${JSON.stringify(event)}`;
      },
      // Проверяет возможность сохранения этого сигнала в БД (в частности, проверяет настройку isSaveToDB)
      async canSaveToDb () {
        return event.can_save_to_db;
      },
      // Функция наложения данных сигнала на уже существующий или отправленный
      async updateByMe (_prevAlertVersion: TAlert): Promise<TAlert> {
        return this;
      },
      alertAlreadySent: {},
    };
    return this.options.alertsBuffer.add(alert);
  };

  onEvent (event: ITestEvent) {
    if (!event.threshold) {
      return;
    }
    this.prepareAlertAndSend(event).then(() => 0);
  }
}
