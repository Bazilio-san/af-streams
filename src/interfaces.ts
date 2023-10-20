/* eslint-disable no-unused-vars */
import EventEmitter from 'events';
import { Socket } from 'socket.io/dist/socket';
import { CallbackOrPromise, PoolOptions } from 'tarn/dist/Pool';
import { Server } from 'socket.io';

export type TEventRecord = { [fieldName: string | symbol]: any };
export type Nullable<T> = T | null;
/**
 * GetNames тип для извлечения набора ключей
 * @template FromType тип - источник ключей
 * @template KeepType критерий фильтрации
 * @template Include признак для указания как интерпретировать критерий фильтрации. В случае false - инвертировать результат для KeepType
 */
export type GetNames<FromType, KeepType = any, Include = true> = {
  [K in keyof FromType]:
  FromType[K] extends KeepType ?
    Include extends true ? K :
      never : Include extends true ?
      never : K
}[keyof FromType];
/**
 * Data from the database, along with related information, to be sent to WSO2 over TCP as JSON
 */
export interface IRecordsComposite {
  sessionId: string,
  streamId: string,
  eventsPacket: TEventRecord[] | TEventRecord, // one or more prepared events
  tcpHeaderLength?: number, // header length when sending a TCP packet
  isSingleRecordAsObject?: boolean, // send a single entry as an object, not a single array element
  first?: TEventRecord, // first packet record sent
  last?: TEventRecord, // last packet record sent
  sendCount?: number, // number of sent records (events)
  sentBufferLength?: number, // total size of sent data
}

/** Information for assembling TCP WSO2 messages */
export interface IEventComposite {
  sessionId: string,
  streamId: string,
  json: string, // sterilized object containing one or more events
}

export interface IEcho extends Function {
  echo: Function,
  error: Function,
  warn: Function,
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
  isLevel?: Function,
}

export interface TAccessPoint {
  consulServiceName: string;
  id: string;
  title: string;
  port: Nullable<number>;
  host: Nullable<string>;
  token: string
  socketRequestId: string
  waitForHostPortUpdated: (_timeout: number) => Promise<boolean>,
}

export interface ISenderConfig {
  type: 'console' | 'tcp' | 'ws' | 'callback' | 'emitter',
  host?: string,
  port?: number
  accessPoint?: TAccessPoint
  eventCallback?: Function,
  emitSingleEvent?: boolean,
  emitId?: string,
}

export type TDbRecord = { [fieldName: string | symbol]: any };
export type TYMDms = string; // 'YYYY-MM-DDTHH:mm:ss.SSS'

export type TFieldType = string;

/*
{
  field1: 'integer',
  field2: 'datetime',
  ...
}
*/
export type TFieldsTypes = { [fieldName: string]: TFieldType };

/*
[
  'ID',
  ['ID2', 'id2'],
  'Deal:Type:Buy',
  ['Deal:Type:Buy', 'dealType'],
  ...
]
 */
export type TFieldList = ([string, string] | string)[];

export type TFields = TFieldsTypes | TFieldList | string;

export interface IDbConfig {
  dialect: 'mssql' | 'pg',
  options?: any,
  host?: string,
  server?: string,
  port: number,
  database: string,
  user: string,
  password: string,
  id?: string, // id объекта настроек БД в config
}

export interface IPoolOptions<T> extends Omit<PoolOptions<T>, 'create' | 'destroy'> {
  create?: CallbackOrPromise<T>;
  destroy?: (_resource: T) => any;
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
  pool: IPoolOptions<any>,
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
  log?: ((..._messages: any[]) => void) | undefined;
  allowExitOnIdle?: boolean | undefined;
  maxUses?: number | undefined;
}

export interface IStreamConfig {
  streamId: string,
  src: {
    schema: string,
    table: string,
    idFields: string[],
    timezoneOfTsField?: string,
    tsField: string,
    dbOptions: IMsSqlConfig | IPostgresConfig,
    dbConfig: IDbConfig,
  }
  fields: TFields,
  prepareEvent?: Function,
  tsFieldToMillis?: Function,
  millis2dbFn?: Function,
  timeDelayMillis?: number, // Искусственное отставание при выборке данных
}

export interface IRedisConfig {
  host?: string,
  port?: string | number
}

export interface ICommonConfig {
  serviceName: string, // Используется для идентификации хранилища времени старта в redis и как id сервиса в WSSender

  logger: ILoggerEx,
  echo: IEcho,
  exitOnError: Function,
  eventEmitter: EventEmitter,

  skipInitDbConnection?: boolean,
}

export interface ISenderConstructorOptions {
  streamId: string,
  senderConfig: ISenderConfig,
  commonConfig: ICommonConfig,
}

export interface ISender {
  sendEvents: Function,
  connect: Function
  destroy: Function
  eventCallback?: Function,
  options: ISenderConstructorOptions
}

export interface IDbConstructorOptions {
  streamConfig: IStreamConfig,
  commonConfig: ICommonConfig,
}

export type TSlot = [leftIndex: number | null, foundIndex: number | null, rightIndex: number | null]

// Event Emitter
export interface IEmPortionOfDataSql {
  streamId: string,
  sql: string, // Portion SQL
  startTs: number,
  endTs: number,
  limit: number,
  dbInfo: string,
}

export interface IEmNextRecordTsSql {
  streamId: string,
  sql: string,
  fromTs: number,
  dbInfo: string,
  nextRecordTs: number | undefined
}

export interface IEmPortionOfDataCount {
  streamId: string,
  sql: string, // Portion SQL
  count: number, // The number of records retrieved from the database in this portion
}

export interface IEmVirtualHourChanged {
  prevN: number, // number of the previous hour since the beginning of the computer era
  currN: number, // number of the current hour since the beginning of the computer era
  prevHZ: number, // number of the previous hour from the beginning of the day
  currHZ: number, // number of the current hour from the beginning of the day
  prevTs: number, // timestamp of the beginning of the previous hour
  currTs: number, // timestamp of the beginning of the current hour
}

export interface IEmVirtualDateChanged {
  prevN: number, // previous date number since the beginning of the computer era
  currN: number, // current date number since the beginning of the computer era
  prevTs: number, // timestamp of the beginning of the previous date
  currTs: number, // timestamp of the start of the current date
}

export interface IEmSubtractedLastTimeRecords {
  streamId: string,
  subtractedLastTimeRecords: TDbRecord[]
}

export interface IEmCurrentLastTimeRecords {
  streamId: string,
  currentLastTimeRecords: TDbRecord[]
}

export interface IEmBeforeLoadNextPortion {
  streamId: string,
  startTs: number,
  endTs: number,
  timeDelayMillis: number,
  vt: number,
}

export interface IEmAfterLoadNextPortion {
  streamId: string,
  // Left time limit in last request
  startTs: number,
  // Right time limit in last request
  endTs: number,
  timeDelayMillis: number,
  limit: number,
  // Timestamp of the last received record
  lastRecordTs: number,
  // Left border for next request
  nextStartTs: number,
  recordsetLength: number,
  isLimitExceed: boolean,
  last: TEventRecord | null,
  vt: number, // Virtual time stamp
  lastSpeed: number,
  totalSpeed: number,
  queryDurationMillis: number,
}

export interface IStreamStat extends IEmAfterLoadNextPortion {
}

export interface IEmSaveLastTs {
  streamId: string,
  lastTs: number,
}

export interface IStreamLike {
  gapEdge: number,
  getDesiredTimeFront: (_timeFront: number, _timeShift: number) => number,
}

export interface IEmFindNextTs {
  streamId: string,
  o: number,
  n: number,
  gap: number,
}

// eslint-disable-next-line no-shadow
export enum EWinInsertType {
  REMOVE = -1,
  FIRST = 0,
  LEFT = 1,
  MIDDLE = 2,
  RIGHT = 3,
}

export interface ISocket extends Socket {
  getCallback: Function
  callBack: Function
  applyFn: Function
}

export interface IOFnArgs {
  socket: ISocket,
  io: Server
}
