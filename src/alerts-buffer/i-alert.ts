// Данные для таблицы [dbo].[alert].
export interface TAlertTableRecord {
  // уникальный идентификатор сигнала
  guid: string,
  // Числовой ID типа сигнала из справочника [dbo].[alertType]
  alertTypeId: number,
  // время возникновения сигнала
  ts: number,
  // Сведения о событии
  info_json?: any,
  // Время последнего обновления записи
  updatedAt?: number | Date,
}

export interface TAlertSentFlags {
  byEmail?: boolean,
  toDb?: boolean,
  noUpdateToProcForOperators?: boolean,
}

export interface TAlertsBufferRequired {
  // Числовой ID типа сигнала из справочника [dbo].[alertType]. Добавляется перед самой отправкой алерта
  alertTypeId?: number,
  // уникальный идентификатор сигнала
  eventName: string,

  // Технический атрибут.  Содержит признаки отправки по Email и сохранения в БД. Используется на этапе фильтрации алертов в буфере.
  alertAlreadySent: TAlertSentFlags,

  // Теги в теле письма
  hashTags?: string[],
  // Подготавливает список получателей, шаблон заголовка и тело письма (HTML) для отправки уведомления по email.
  // В случае отсутствия в ответе функции свойств subjectTemplate и htmlBody, будет использованы их значения по умолчанию.
  getEmail: () => Promise<{ recipients: string[], subjectTemplate?: string, htmlBody?: string }>,
  // Подготавливает ключевые сведения о сигнале для вывода в консоль в режиме отладки.
  // Добавляются к префиксу с типом и guid сигнала. При отсутствии этой функции, выведется только префикс.
  getDebugMessage?: () => string,

  // Проверяет возможность сохранения этого сигнала в БД (в частности, проверяет настройку isSaveToDB)
  canSaveToDb?: () => Promise<boolean>,
  // Проверяет возможность отправки сигнала по Email (в частности, проверяет настройку isSendByEmail)
  canSendByEmail?: () => Promise<boolean>,

  // Функция наложения данных сигнала на уже существующий или отправленный
  // eslint-disable-next-line no-use-before-define
  updateByMe?: (prevAlertVersion: TAlert) => Promise<TAlert>,
}

// Данные, сопутствующие сигналу.
export interface TAlert<T = any> extends Omit<TAlertTableRecord, 'alertTypeId'>, TAlertsBufferRequired {
  // Наряду со свойством info_json, которое предназначено для сериализация и сохранения в БД,
  // в этом свойстве храним сущности, не предназначенные для сериализация. (Например, даты в представлении luxon)
  payload?: T,
}

export type TAlertEmailDetails = [string, string | number | null][]

export interface IAlertEmailSettings {
  from: string,
  smtp: {
    host: string,
    port: string | number,
    auth: {
      user: string,
      pass: string,
    },
    secure: boolean,
    tls?: {
      rejectUnauthorized: boolean
    },
  },
  throttleAlertsIntervalSeconds?: number, // Секунды! Интервал времени, ограничивающий частоту рассылки алертов
  subjectPrefix?: string,
}

export interface TMergeResult {
  // кол-во затронутых записей
  total: number,
  // кол-во добавленных записей
  inserted: number,
  // кол-во измененных записей
  updated: number,
}
