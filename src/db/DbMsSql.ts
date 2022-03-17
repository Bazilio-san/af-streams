import * as sql from 'mssql';
import { IDbConstructorOptions, IMsSqlConfig } from '../interfaces';
import { DbBase } from './DbBase';

const mssqlDefaults: IMsSqlConfig = {
  options: { enableArithAbort: false },
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: 300000,
  },
  trustServerCertificate: true,
  stream: false,
  parseJSON: false,
  requestTimeout: 1800000,
  connectionTimeout: 3600000,
  server: '',
};

export class DbMsSql extends DbBase {
  public pool: sql.ConnectionPool | null;

  public cfg: IMsSqlConfig;

  public request: sql.Request | null;

  constructor (options: IDbConstructorOptions) {
    super(options);

    this.pool = null;
    const { dbOptions, dbConfig } = options;
    const mssqlDbOptions = { ...mssqlDefaults, ...(dbOptions || {}) };
    ['options', 'pool'].forEach((propName) => {
      if (typeof dbOptions?.[propName] === 'object') {
        Object.assign(mssqlDbOptions[propName], dbOptions[propName]);
      }
    });
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
    const { logger } = this.options;
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
      this.options.logger.info(`Mssql connection pool for "${this.dbInfo}" closed`);
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
}
