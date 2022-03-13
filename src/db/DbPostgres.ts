/* eslint-disable @typescript-eslint/no-unused-vars,no-unused-vars */
import { Pool, PoolConfig } from 'pg';
import { IDbConstructorOptions, IPostgresConfig, TDbRecord, TYMDms } from '../interfaces';

const postgresDefaults: PoolConfig = {
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

export class DbPostgres {
  private readonly options: IDbConstructorOptions;

  private pool: Pool | null;

  private readonly cfg: IPostgresConfig;

  public dbInfo: string;

  private fieldsList: string;

  public schemaAndTable: string;

  private tsField: string;

  private idFields: string[] | any[];

  private sortBy: string;

  constructor (options: IDbConstructorOptions) {
    this.options = options;
    const { streamConfig, dbOptions, dbConfig } = options;
    const postgresDbOptions = { ...postgresDefaults, ...(dbOptions || {}) };
    this.cfg = { ...postgresDbOptions, ...dbConfig } as IPostgresConfig;
    this.dbInfo = `${dbConfig.user}@"${dbConfig.host}:${dbConfig.port}"."${dbConfig.database}"`;

    const { fieldsTypes, src } = streamConfig;
    const { schema, table, tsField, idFields } = src;

    this.fieldsList = Object.keys(fieldsTypes).map(([fName]) => `"${fName}"`).join(', ');
    this.schemaAndTable = `"${schema}"."${table}"`;
    this.tsField = tsField;
    this.idFields = idFields;
    this.sortBy = [tsField, ...idFields].map((f) => `, "${f}"`).join(',');
    this.pool = null;
  }

  private async getPool () {
    // if (this.pool?.connected || this.pool?.connecting) { // VVQ ?.connected
    //   return this.pool;
    // }
    if (this.pool) {
      return this.pool;
    }
    this.pool = new Pool(this.cfg);
    // if (this.pool?.close) { VVQ
    //   await this.pool.close();
    // }
    return this.pool;
  }

  async close () {
    const self = this; // VVQ
  }

  async closeAndExit () {
    await this.close();
    process.exit(0);
  }

  async query (strSQL: string) {
    const pool = await this.getPool();
    return pool.query(strSQL);
  }

  async init () {
    const { schemaAndTable, options: { exitOnError, streamConfig: { streamId, fieldsTypes } } } = this;
    const fieldsArray = Object.keys(fieldsTypes);
    const { fields } = await this.query(`SELECT TOP (1) *
                                     FROM ${schemaAndTable}`);
    const columnsArray = fields.map(({ name }) => name);
    const unknownFields = fieldsArray.filter((name) => !columnsArray.includes(name));
    if (unknownFields.length) {
      return exitOnError(`Table ${schemaAndTable} is missing fields specified in the ${streamId} stream configuration:\n\t${unknownFields.join('\n\t')} `);
    }
  }

  async getPortionOfData (from: TYMDms, to: TYMDms): Promise<TDbRecord[]> {
    const { schemaAndTable, tsField, sortBy, fieldsList } = this;
    const strSQL = `SELECT ${fieldsList}
                    FROM ${schemaAndTable}
                    WHERE "${tsField}" >= '${from}'
                      AND "${tsField}" <= '${to}'
                    ORDER BY ${sortBy}`;
    const result = await this.query(strSQL);
    return result?.rows || [];
  }
}
