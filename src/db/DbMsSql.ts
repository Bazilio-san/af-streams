import * as sql from 'mssql';
import { IDbConstructorOptions, IMsSqlConfig, TDbRecord, TYMDms } from '../interfaces';

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

export class DbMsSql {
  private readonly options: IDbConstructorOptions;

  private pool: sql.ConnectionPool | null;

  private readonly cfg: IMsSqlConfig;

  public dbInfo: string;

  private fieldsList: string;

  public schemaAndTable: string;

  private tsField: string;

  private idFields: string[] | any[];

  private sortBy: string;

  private request: sql.Request | null;

  constructor (options: IDbConstructorOptions) {
    this.options = options;
    const { streamConfig, dbOptions, dbConfig } = options;
    const mssqlDbOptions = { ...mssqlDefaults, ...(dbOptions || {}) };
    ['options', 'pool'].forEach((propName) => {
      if (typeof dbOptions?.[propName] === 'object') {
        Object.assign(mssqlDbOptions[propName], dbOptions[propName]);
      }
    });
    this.cfg = { ...mssqlDbOptions, ...dbConfig, server: dbConfig.host } as IMsSqlConfig;
    this.dbInfo = `${dbConfig.user}@[${dbConfig.host}:${dbConfig.port}].[${dbConfig.database}]`;

    const { fieldsTypes, src } = streamConfig;
    const { schema, table, tsField, idFields } = src;

    this.fieldsList = Object.keys(fieldsTypes).map((fName) => `[${fName}]`).join(', ');
    this.schemaAndTable = `[${schema}].[${table}]`;
    this.tsField = tsField;
    this.idFields = idFields;
    this.sortBy = [tsField, ...idFields].map((f) => `[${f}]`).join(',');
    this.pool = null;
    this.request = null;
  }

  private async getPool () {
    if (this.pool?.connected || this.pool?.connecting) {
      return this.pool;
    }
    if (this.pool?.close) {
      await this.pool.close();
    }
    this.pool = null;
    const { logger } = this.options;
    try {
      this.pool = new sql.ConnectionPool(this.cfg);
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

  async close () {
    if (this.pool?.close) {
      await this.pool.close();
      this.options.logger.info(`Mssql connection pool for "${this.dbInfo}" closed`);
    }
  }

  async closeAndExit () {
    await this.close();
    process.exit(0);
  }

  async getRequest () {
    if (!this.request) {
      const pool = await this.getPool();
      this.request = new sql.Request(pool);
    }
    return this.request;
  }

  async query (strSQL: string) {
    const request = await this.getRequest();
    return request.query(strSQL);
  }

  async init () {
    const { schemaAndTable, options: { exitOnError, streamConfig: { streamId, fieldsTypes } } } = this;
    const fieldsArray = Object.keys(fieldsTypes);
    const result = await this.query(`SELECT TOP (1) *
                                     FROM ${schemaAndTable}`);
    const { columns } = result.recordset;
    const unknownFields = fieldsArray.filter((fName) => !columns[fName]);
    if (unknownFields.length) {
      return exitOnError(`Table ${schemaAndTable} is missing fields specified in the ${streamId} stream configuration:\n\t${unknownFields.join('\n\t')} `);
    }
  }

  async getPortionOfData (from: TYMDms, to: TYMDms): Promise<TDbRecord[]> {
    const { schemaAndTable, tsField, sortBy, fieldsList } = this;
    const strSQL = `SELECT ${fieldsList}
                    FROM ${schemaAndTable}
                    WHERE [${tsField}] >= '${from}'
                      AND [${tsField}] <= '${to}'
                    ORDER BY ${sortBy}`;
    const result = await this.query(strSQL);
    return result?.recordset || [];
  }
}
