import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { DateTime } from 'luxon';
import { color, echo, logger } from './logger';

export const TEST_DB = 'af-streams-test';
export const TEST_SCHEMA = 'test';
export const TEST_TABLE = 'test';
export const ALERT_TABLE = 'alert';
export const ACTIONS_TABLE = 'alert_actions';

const dbConnectionConfig = require('./local.db.config.json');

const COMMON_DB_CONFIG = {
  connectionTimeoutMillis: 300_000,
  idleTimeoutMillis: 300_000,
  max: 10,
  statement_timeout: 300_000,
  query_timeout: 300_000,
  database: TEST_DB,
};

export const dbConfig = { ...COMMON_DB_CONFIG, ...dbConnectionConfig, dbId: TEST_DB };

export interface IPoolClient extends PoolClient {
  _connected: boolean,
  processID: number,
  database: string,
  end: Function,
}

export interface IPool extends Pool {
  _clients: IPoolClient[]
}

const pools: {
  [connectionId: string]: IPool
} = {};

export const getPool = async (connectionId: string = TEST_DB): Promise<IPool> => {
  if (!pools[connectionId]) {
    const poolConfig: PoolConfig = dbConfig;
    const pool = new Pool(poolConfig) as IPool;
    pools[connectionId] = pool;
    pool.on('error', (err: Error, client: PoolClient) => {
      client.release(true);
      logger.error(err);
    });
    pool.on('connect', (client: PoolClient) => {
      const { database, processID } = client as unknown as IPoolClient;
      echo.debug(`PG client [${connectionId}] connected! DB: "${database}" / processID: ${processID}`);
    });
    pool.on('remove', (client: PoolClient) => {
      const { database, processID } = client as unknown as IPoolClient;
      echo.debug(`PG client [${connectionId}] removed. DB: "${database}" / processID: ${processID}`);
    });
    await pool.connect();
  }
  return pools[connectionId];
};

export const closePool = async (connectionId: string = TEST_DB): Promise<boolean> => {
  const pool = pools[connectionId];
  if (!pool) {
    return true;
  }
  const fns = (pool._clients || [])
    .filter((client: IPoolClient) => client?._connected && typeof client?.end === 'function')
    .map((client: IPoolClient) => client.end());
  await Promise.all(fns);
  return true;
};

export const query = async <R extends QueryResultRow = any> (
  sqlText: string,
  sqlValues?: any[],
  throwError = false,
  connectionId: string = TEST_DB,
): Promise<QueryResult<R> | undefined> => {
  const pool: IPool = await getPool(connectionId);
  let res: QueryResult;
  try {
    if (Array.isArray(sqlValues)) {
      res = await pool.query(sqlText, sqlValues);
    } else {
      res = await pool.query(sqlText);
    }
    return res;
  } catch (err) {
    logger.error(`SQL Error:\n${color.magenta}${sqlText}${color.red}`);
    logger.error(err);
    if (throwError) {
      throw err;
    }
  }
};

/** Закрывает все соединения с БД и завершает работу скрипта */
export const graceExit = async () => {
  await Promise.all(Object.keys(pools).map((connectionId) => closePool(connectionId)));
  process.exit(0);
};

export const getRecordValueSQL = (fieldValue: any, fieldType: string): string | number => {
  let v;
  switch (fieldType) {
    case 'int':
      if (fieldValue == null) {
        return 'NULL';
      }
      v = +fieldValue;
      if (Number.isNaN(v)) {
        return 'NULL';
      }
      return Math.floor(v);
    case 'number':
      if (fieldValue == null) {
        return 'NULL';
      }
      v = +fieldValue;
      if (Number.isNaN(v)) {
        return 'NULL';
      }
      return v;
    case 'timestamp':
      if (fieldValue == null) {
        return 'NULL';
      }
      if (typeof fieldValue === 'number') {
        v = DateTime.fromMillis(fieldValue);
      } else if (fieldValue instanceof Date) {
        v = DateTime.fromJSDate(fieldValue);
      } else {
        v = DateTime.fromISO(String(fieldValue));
      }
      if (!v.isValid) {
        return 'NULL';
      }
      return `'${v.toSQL()}'`;
    case 'text':
    case 'string':
      if (fieldValue == null) {
        return 'NULL';
      }
      return `'${fieldValue}'`;
    case 'json':
      if (fieldValue == null) {
        return 'NULL';
      }
      return `'${JSON.stringify(fieldValue)}'`;
    case 'boolean':
      return fieldValue ? 'True' : 'False';
    default:
      return `'${fieldValue}'`;
  }
};
