// @ts-ignore
import * as pg from 'pg';
import { millisTo } from 'af-tools-ts';
import { IDbConstructorOptions, IPostgresConfig } from '../interfaces';
import { DbBase } from './DbBase';

const postgresDefaults: pg.PoolConfig = {
  // all valid client config options are also valid here
  // in addition here are the pool specific configuration parameters:
  // number of milliseconds to wait before timing out when connecting a new client
  // by default this is 0 which means no timeout
  connectionTimeoutMillis: 30000,
  // number of milliseconds a client must sit idle in the pool and not be checked out
  // before it is disconnected from the backend and discarded
  // default is 10000 (10 seconds) - set to 0 to disable auto-disconnection of idle clients
  idleTimeoutMillis: 10000,
  // maximum number of clients the pool should contain
  // by default this is set to 10.
  max: 10,
  statement_timeout: 30000, // number of milliseconds before a statement in query will time out, default is no timeout
  query_timeout: 30000, // number of milliseconds before a query call will timeout, default is no timeout
};

export class DbPostgres extends DbBase {
  public pool: pg.Pool | null;

  public cfg: IPostgresConfig;

  constructor (options: IDbConstructorOptions) {
    super(options);

    this.pool = null;
    const { dbOptions, dbConfig } = options.streamConfig.src;
    const postgresDbOptions = { ...postgresDefaults, ...(dbOptions || {}) };
    this.cfg = { ...postgresDbOptions, ...dbConfig } as IPostgresConfig;

    const { streamConfig } = options;
    const { millis2dbFn } = streamConfig;
    this.millis2dbFn = typeof millis2dbFn === 'function'
      ? millis2dbFn.bind(this)
      : (millis: number) => millisTo.db.pgUtc(millis);
    streamConfig.millis2dbFn = this.millis2dbFn;
  }

  async getPool () {
    if (this.pool) {
      return this.pool;
    }
    this.pool = new pg.Pool(this.cfg);
    return this.pool;
  }

  async close (): Promise<boolean> {
    const self = this;
    return new Promise((resolve) => {
      self.pool?.end().then(() => resolve(true));
    });
  }

  async query (strSQL: string) {
    const pool = await this.getPool();
    return pool.query(strSQL);
  }

  async _getColumnsNames (): Promise<string[]> {
    const { fields } = await this.query(`${'SELECT'} * FROM ${this.schemaAndTable} LIMIT 1`);
    return fields.map((field: any) => field.name);
  }

  // eslint-disable-next-line class-methods-use-this
  limitIt (strSQL: string, limit: number): string {
    return `${strSQL} LIMIT ${limit}`;
  }

  async destroy () {
    await this.close();
    super.destroy();
    this.pool = null;
    // @ts-ignore
    this.cfg = undefined;
  }
}
