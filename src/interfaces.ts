import * as sql from 'mssql';
import * as pg from 'pg';
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

/** Сведения для сборки TCP сообщения для WSO2 */
export interface IEventComposite { // VVR
  sessionId: string, // ID сессии
  streamId: string, // ID потока
  json: string, // серилизованный объект, содержащий одно или более событий
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

export interface IDbConfig {
  dialect: 'mssql' | 'pg',
  host: string,
  port: number,
  database: string,
  user: string,
  password: string,
}

export interface IMsSqlConfig extends sql.config {
  trustServerCertificate?: boolean
}

export interface IPostgresConfig extends pg.PoolConfig {}

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
  fieldsTypes: TFieldsTypes,
  printInfoIntervalSec?: number,
}

export interface IDbConstructorOptions {
  streamConfig: IStreamConfig,
  logger: ILoggerEx,
  exitOnError: Function,
  dbOptions: IMsSqlConfig | IPostgresConfig,
  dbConfig: IDbConfig
}
