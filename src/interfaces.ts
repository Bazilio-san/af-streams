import EventEmitter from 'events';

export type TEventRecord = { [fieldName: string | symbol]: any };
export type Nullable<T> = T | null;

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
  eventCallback?: Function,
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
  eventCallback?: Function,
}

export type TDbRecord = { [fieldName: string | symbol]: any };
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
  maxBufferSize?: number,
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
  printInfoIntervalSec?: number,
}

export interface IDbConstructorOptions {
  streamConfig: IStreamConfig,
  logger: ILoggerEx,
  eventEmitter: EventEmitter,
  exitOnError: Function,
  dbOptions: IMsSqlConfig | IPostgresConfig,
  dbConfig: IDbConfig,
  millis2dbFn: Function
}

export type TSlot = [leftIndex: number | null, foundIndex: number | null, rightIndex: number | null]
