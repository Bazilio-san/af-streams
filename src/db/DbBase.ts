/* eslint-disable class-methods-use-this */
import { IDbConstructorOptions, TDbRecord } from '../interfaces';
import { DEBUG_SQL } from '../constants';

export class DbBase {
  public readonly options: IDbConstructorOptions;

  public dbInfo: string;

  public fieldsList: string;

  public schemaAndTable: string;

  public fieldsArray: string[];

  public tsField: string;

  public idFields: string[] | any[];

  public sortBy: string;

  private ld: string;

  private rd: string;

  private noLock: string = '';

  private readonly recordsetPropName: string;

  constructor (options: IDbConstructorOptions) {
    this.options = options;
    const { streamConfig, dbConfig } = options;
    let host;
    if (dbConfig.dialect === 'mssql') {
      this.ld = '[';
      this.rd = ']';
      this.recordsetPropName = 'recordset';
      this.noLock = ' WITH(NOLOCK) ';
      host = dbConfig.server;
    } else {
      this.ld = '"';
      this.rd = '"';
      this.recordsetPropName = 'rows';
      ({ host } = dbConfig);
    }
    const { ld, rd } = this;
    this.dbInfo = `${dbConfig.user}@${ld}${host}:${dbConfig.port}${rd}.${ld}${dbConfig.database}${rd}`;
    const { fields, src } = streamConfig;
    const { schema, table, tsField, idFields } = src;
    if (Array.isArray(fields)) {
      this.fieldsArray = [...fields];
    } else {
      this.fieldsArray = Object.keys(fields);
    }
    this.fieldsList = this.fieldsArray.map((fName) => `${ld}${fName}${rd}`).join(', ');
    this.schemaAndTable = `${ld}${schema}${rd}.${ld}${table}${rd}`;
    this.tsField = tsField;
    this.idFields = idFields;
    this.sortBy = [tsField, ...idFields].map((f) => `${ld}${f}${rd}`).join(',');
  }

  async getPool (): Promise<any> {
    return null;
  }

  async close (): Promise<boolean> {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars,no-unused-vars
  async query (strSQL: string): Promise<any> {
    return null;
  }

  async _getColumnsNames (): Promise<string[]> {
    return [];
  }

  async init (): Promise<void> {
    const { schemaAndTable, options: { exitOnError, streamConfig: { streamId } }, fieldsArray } = this;
    const columnsNames = await this._getColumnsNames();
    const unknownFields = fieldsArray.filter((name) => !columnsNames.includes(name));
    if (unknownFields.length) {
      exitOnError(`Table ${schemaAndTable} is missing fields specified in the ${streamId} stream configuration:\n\t${unknownFields.join('\n\t')} `);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  limitIt (strSQL: string, limit: number): string {
    return strSQL;
  }

  async getPortionOfData ({ startTs, endTs, limit }: { startTs: number, endTs: number, limit: number }): Promise<TDbRecord[]> {
    const { tsField, ld, rd, options: { millis2dbFn, eventEmitter, streamConfig: { streamId } }, dbInfo } = this;
    //  ${this.noLock}
    let sql = `SELECT ${this.fieldsList}
               FROM ${this.schemaAndTable}
               WHERE ${ld}${tsField}${rd} >= ${millis2dbFn(startTs)}
                 AND ${ld}${tsField}${rd} <= ${millis2dbFn(endTs)}
               ORDER BY ${this.sortBy}`;
    if (limit) {
      sql = this.limitIt(sql, limit);
    }
    if (DEBUG_SQL) {
      eventEmitter.emit('get-portion-of-data-sql', { streamId, sql, startTs, endTs, limit, dbInfo });
    }
    const result = await this.query(sql);
    if (DEBUG_SQL) {
      eventEmitter.emit('get-portion-of-data-count', { streamId, sql, count: result?.[this.recordsetPropName]?.length });
    }
    return result?.[this.recordsetPropName] || [];
  }
}
