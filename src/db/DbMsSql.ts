import * as sql from 'mssql';
import { IDbConstructorOptions, IMsSqlConfig, IPostgresConfig } from '../interfaces';
import { DbBase } from './DbBase';
import { MILLIS_IN_HOUR } from '../constants';

const commonTimeout = MILLIS_IN_HOUR * 3; // 3 ч
const mssqlDefaults: IMsSqlConfig = {
  options: { enableArithAbort: false },
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: commonTimeout,
    acquireTimeoutMillis: commonTimeout,
    createTimeoutMillis: commonTimeout,
    destroyTimeoutMillis: commonTimeout,
    reapIntervalMillis: commonTimeout,
    createRetryIntervalMillis: commonTimeout,
  },
  trustServerCertificate: true,
  stream: false,
  parseJSON: false,
  requestTimeout: commonTimeout,
  connectionTimeout: commonTimeout,
  server: '',
};

export class DbMsSql extends DbBase {
  public pool: sql.ConnectionPool | null;

  public cfg: IMsSqlConfig;

  public request: sql.Request | null;

  constructor (options: IDbConstructorOptions) {
    super(options);

    this.pool = null;
    const { dbOptions, dbConfig } = options.streamConfig.src;
    const mssqlDbOptions = { ...mssqlDefaults, ...(dbOptions || {}) };
    if (dbOptions) {
      ['options', 'pool'].forEach((propName) => {
        const v = dbOptions[propName as keyof (IMsSqlConfig | IPostgresConfig)];
        if (typeof v === 'object') {
          Object.assign((mssqlDbOptions as any)[propName], v);
        }
      });
    }

    this.cfg = { ...mssqlDbOptions, ...dbConfig, server: dbConfig.server || dbConfig.host } as IMsSqlConfig;
    this.request = null;
  }

  async getPool () {
    if (this.pool?.connected || this.pool?.connecting) {
      return this.pool;
    }
    if (this.pool?.close) {
      await this.pool.close();
    }
    this.pool = null;
    const { logger } = this.options.commonConfig;
    try {
      this.pool = new sql.ConnectionPool(this.cfg as sql.config);
      if (typeof this.pool !== 'object') {
        logger.error(`Cant create mssql connection pool: ${this.dbInfo}`);
        process.exit(0);
      }
      this.pool.on('close', () => {
        this.pool = null;
      });
      this.pool.on('error', (err: Error | any) => {
        logger.error('POOL-ERROR');
        logger.error(err);
      });
      await this.pool.connect();
      return this.pool;
    } catch (err) {
      logger.error('POOL-ERROR');
      logger.error(`Cant connect to ${this.dbInfo}\n${err}\nEXIT PROCESS`);
      process.exit(1);
    }
  }

  async close (): Promise<boolean> {
    if (this.pool?.close) {
      await this.pool.close();
      this.options.commonConfig.logger.info(`Mssql connection pool for "${this.dbInfo}" closed`);
      return true;
    }
    return false;
  }

  async query (strSQL: string) {
    if (!this.request) {
      const pool = await this.getPool();
      this.request = new sql.Request(pool);
    }
    return this.request.query(strSQL);
  }

  async _getColumnsNames (): Promise<string[]> {
    const result = await this.query(`${'SELECT'} TOP (1) * FROM ${this.schemaAndTable}`);
    const { columns } = result.recordset;
    return Object.keys(columns);
  }

  // eslint-disable-next-line class-methods-use-this
  limitIt (strSQL: string, limit: number): string {
    return strSQL.replace('SELECT ', `SELECT TOP(${limit}) `);
  }
}
