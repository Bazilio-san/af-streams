/* eslint-disable class-methods-use-this */
import { IDbConstructorOptions, IEmNextRecordTsSql, IEmPortionOfDataCount, IEmPortionOfDataSql, TDbRecord } from '../interfaces';
import { DEBUG_SQL } from '../constants';
import { millis2iso } from '../utils/date-utils';

export class DbBase {
  public readonly options: IDbConstructorOptions;

  public dbInfo: string;

  public fieldsList: string;

  public schemaAndTable: string;

  public tableFieldNameArray: string[];

  public tsField: string;

  private tsFieldQuoted: string;

  public idFields: string[] | any[];

  public sortBy: string;

  private ld: string;

  private rd: string;

  private noLock: string = '';

  private readonly recordsetPropName: string;

  public readonly millis2dbFn: Function;

  constructor (options: IDbConstructorOptions) {
    this.options = options;
    const { streamConfig } = options;
    const { src: { dbConfig }, millis2dbFn } = streamConfig;

    this.millis2dbFn = typeof millis2dbFn === 'function'
      ? millis2dbFn.bind(this)
      : (millis: number) => `'${millis2iso(millis)}'`;
    streamConfig.millis2dbFn = this.millis2dbFn;

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
    const fieldDefs: string[] = [];
    this.tableFieldNameArray = [];
    if (Array.isArray(fields)) {
      fields.forEach((fieldDefAny: [string, string] | string) => {
        if (Array.isArray(fieldDefAny)) {
          const [fName, fAlias] = fieldDefAny;
          fieldDefs.push(`${ld}${fName}${rd} AS ${ld}${fAlias}${rd}`);
          this.tableFieldNameArray.push(fName);
        } else {
          fieldDefs.push(`${ld}${fieldDefAny}${rd}`);
          this.tableFieldNameArray.push(fieldDefAny);
        }
      });
      this.fieldsList = fieldDefs.join(', ');
    } else if (typeof fields === 'object') {
      this.tableFieldNameArray = Object.keys(fields);
      this.fieldsList = this.tableFieldNameArray.map((fName) => `${ld}${fName}${rd}`).join(', ');
    } else { // typeof fields === 'string'
      this.fieldsList = fields;
    }
    this.schemaAndTable = `${ld}${schema}${rd}.${ld}${table}${rd}`;
    this.tsField = tsField;
    this.tsFieldQuoted = `${ld}${tsField}${rd}`;
    this.idFields = idFields;
    this.sortBy = [tsField, ...idFields].map((f) => `${ld}${f}${rd}`).join(',');
  }

  async getPool (): Promise<any> {
    return null;
  }

  async close (): Promise<boolean> {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars,no-unused-vars,unused-imports/no-unused-vars
  async query (strSQL: string): Promise<any> {
    return null;
  }

  async _getColumnsNames (): Promise<string[]> {
    return [];
  }

  async init (): Promise<void> {
    const { schemaAndTable, options, tableFieldNameArray } = this;
    const columnsNames = await this._getColumnsNames();
    const unknownFields = tableFieldNameArray.filter((name) => !columnsNames.includes(name));
    if (unknownFields.length) {
      options.commonConfig.exitOnError(`Table ${schemaAndTable} is missing fields specified in the ${options.streamConfig.streamId} stream configuration:\n\t${unknownFields.join('\n\t')} `);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars,unused-imports/no-unused-vars
  limitIt (_strSQL: string, _limit: number): string {
    // Stub function that is overridden in child classes
    return _strSQL;
  }

  getPortionSQL ({ startTs, endTs, limit }: { startTs: number, endTs: number, limit: number }): string {
    const { tsFieldQuoted, millis2dbFn } = this;
    let sql = `${'    SELECT'} ${this.fieldsList}
    FROM ${this.schemaAndTable} WHERE ${tsFieldQuoted} >= ${millis2dbFn(startTs)} AND ${tsFieldQuoted} <= ${millis2dbFn(endTs)} ORDER BY ${this.sortBy}`;
    if (limit) {
      sql = this.limitIt(sql, limit);
    }
    return sql;
  }

  async getPortionOfData ({ startTs, endTs, limit, timeDelayMillis }: { startTs: number, endTs: number, limit: number, timeDelayMillis: number }): Promise<TDbRecord[]> {
    const { dbInfo, options } = this;
    const { streamId } = options.streamConfig;
    const { eventEmitter } = options.commonConfig;
    startTs += timeDelayMillis;
    endTs += timeDelayMillis;
    const sql = this.getPortionSQL({ startTs, endTs, limit });
    if (DEBUG_SQL) {
      const payload: IEmPortionOfDataSql = { streamId, sql, startTs, endTs, limit, dbInfo };
      eventEmitter.emit('get-portion-of-data-sql', payload);
    }
    const result = await this.query(sql);
    if (DEBUG_SQL) {
      const payload: IEmPortionOfDataCount = { streamId, sql, count: result?.[this.recordsetPropName]?.length };
      eventEmitter.emit('get-portion-of-data-count', payload);
    }
    return result?.[this.recordsetPropName] || [];
  }

  getNextRecordSQL (fromTs: number): string {
    const { tsFieldQuoted, millis2dbFn } = this;
    let sql = `${'    SELECT'} ${tsFieldQuoted} AS ts
    FROM ${this.schemaAndTable} WHERE ${tsFieldQuoted} > ${millis2dbFn(fromTs)} ORDER BY ${tsFieldQuoted}`;
    sql = this.limitIt(sql, 1);
    return sql;
  }

  async getNextRecordTs (fromTs: number): Promise<number | undefined> {
    const { dbInfo, options } = this;
    const { streamId } = options.streamConfig;
    const { eventEmitter, logger } = options.commonConfig;
    const sql = this.getNextRecordSQL(fromTs);
    let result;
    let nextRecordTs: number | undefined;
    try {
      result = await this.query(sql);
      nextRecordTs = result?.[this.recordsetPropName]?.[0]?.ts;
    } catch (err) {
      logger.error(err);
    }
    if (DEBUG_SQL) {
      const payload: IEmNextRecordTsSql = { streamId, sql, fromTs, dbInfo, nextRecordTs };
      eventEmitter.emit('get-next-record-ts-sql', payload);
    }
    return nextRecordTs;
  }
}
