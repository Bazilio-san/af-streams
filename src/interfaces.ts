import EventEmitter from 'events';

export type TEventRecord = { [fieldName: string]: any };
export type Nullable<T> = T | null;

/**
 * Данные из БД вместе с сопутствующей информацией,
 * для отправки в WSO2 по TCP в виде JSON
 */
export interface IRecordsComposite {
  sessionId: string, // ID сессии
  streamId: string, // ID потока
  eventsPacket: TEventRecord[] | TEventRecord, // одно или более подготовленных событий
  tcpHeaderLength?: number, // длина заголовка при отправке TCP пакета
  isSingleRecordAsObject?: boolean, // отправлять одну запись как объект, а не один элемент массива
  first?: TEventRecord, // первая отправленная запись пакета
  last?: TEventRecord, // последняя отправленная запись пакета
  sendCount?: number, // кол-во отправленных записей (событий)
  sentBufferLength?: number, // суммарный размер отправленных данных
}

/** Сведения для сборки TCP сообщения WSO2 */
export interface IEventComposite {
  sessionId: string, // ID сессии
  streamId: string, // ID потока
  json: string, // стерилизованный объект, содержащий одно или более событий
}

export interface IEcho extends Function {
  echo: Function,
  error: Function,
  info: Function,
  debug: Function,
  silly: Function,
}

export interface ILoggerEx {
  error: Function,
  warn: Function,
  info: Function,
  debug: Function,
  silly: Function,
  isLevel: Function,
}

export interface TAccessPoint {
  consulServiceName: string;
  id: string;
  title: string;
  port: Nullable<number>;
  host: Nullable<string>;
  token: string
  socketRequestId: string
  waitForHostPortUpdated: (timeout: number) => Promise<boolean>,
}

export interface ISenderConfig {
  type: 'console' | 'tcp' | 'ws' | 'callback' | 'emitter',
  host?: string,
  port?: number
  accessPoint?: TAccessPoint
  callback?: Function,
  emitSingleEvent?: boolean,
  emitId?: string,
}

export interface ISenderConstructorOptions {
  senderConfig: ISenderConfig,
  serviceName: string,
  logger: ILoggerEx,
  echo: IEcho,
  exitOnError: Function,
  eventEmitter: EventEmitter,
}

export interface ISender {
  sendEvents: Function,
  connect: Function
}

export type TDbRecord = { [fieldName: string]: any };
export type TYMDms = string; // 'YYYY-MM-DDTHH:mm:ss.SSS'

export type TFieldType = string;
export type TFieldsTypes = { [fieldName: string]: TFieldType };
export type TFieldList = string[];
export type TFields = TFieldsTypes | TFieldList;

export interface IDbConfig {
  dialect: 'mssql' | 'pg',
  host?: string,
  server?: string,
  port: number,
  database: string,
  user: string,
  password: string,
}

export interface IMsSqlConfig {
  driver?: string | undefined;
  user?: string | undefined;
  password?: string | undefined;
  server: string;
  port?: number | undefined;
  domain?: string | undefined;
  database?: string | undefined;
  arrayRowMode?: boolean | undefined;
  beforeConnect?: Function
  options?: {
    beforeConnect?: void | undefined;
    connectionString?: string | undefined;
    enableArithAbort?: boolean | undefined;
    instanceName?: string | undefined;
    trustedConnection?: boolean | undefined;
    useUTC?: boolean | undefined;
  };
  pool: {
    max: number,
    min: number,
    idleTimeoutMillis: number
  },
  trustServerCertificate?: boolean | undefined,
  stream?: boolean | undefined;
  parseJSON?: boolean | undefined;
  requestTimeout?: number | undefined;
  connectionTimeout?: number | undefined;
}

export interface IPostgresClientConfig {
  user?: string | undefined;
  database?: string | undefined;
  password?: string | (() => string | Promise<string>) | undefined;
  port?: number | undefined;
  host?: string | undefined;
  connectionString?: string | undefined;
  keepAlive?: boolean | undefined;
  statement_timeout?: false | number | undefined;
  parseInputDatesAsUTC?: boolean | undefined;
  ssl?: any
  keepAliveInitialDelayMillis?: number | undefined;
  idle_in_transaction_session_timeout?: number | undefined;
  application_name?: string | undefined;
  connectionTimeoutMillis?: number | undefined;
  options?: string | undefined;
}

export interface IPostgresConfig extends IPostgresClientConfig {
  max?: number | undefined;
  min?: number | undefined;
  idleTimeoutMillis?: number | undefined;
  log?: ((...messages: any[]) => void) | undefined;
  allowExitOnIdle?: boolean | undefined;
  maxUses?: number | undefined;
}

export interface IStreamConfig {
  streamId: string,
  fetchIntervalSec?: number,
  bufferMultiplier?: number,
  src: {
    schema: string,
    table: string,
    idFields: string[],
    tsField: string,
    dbOptions: IMsSqlConfig | IPostgresConfig,
    dbConfig: IDbConfig,
  }
  fields: TFields,
  printInfoIntervalSec?: number,
}

export interface IDbConstructorOptions {
  streamConfig: IStreamConfig,
  logger: ILoggerEx,
  exitOnError: Function,
  dbOptions: IMsSqlConfig | IPostgresConfig,
  dbConfig: IDbConfig
}
