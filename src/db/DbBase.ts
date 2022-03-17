/* eslint-disable @typescript-eslint/no-unused-vars,no-unused-vars */
import * as pg from 'pg';
import * as sql from 'mssql';
import { IDbConstructorOptions, TDbRecord, TYMDms } from '../interfaces';

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

  private readonly recordsetPropName: string;

  constructor (options: IDbConstructorOptions) {
    this.options = options;
    const { streamConfig, dbConfig } = options;
    if (dbConfig.dialect === 'mssql') {
      this.ld = '[';
      this.rd = ']';
      this.recordsetPropName = 'recordset';
    } else {
      this.ld = '"';
      this.rd = '"';
      this.recordsetPropName = 'rows';
    }
    const { ld, rd } = this;
    this.dbInfo = `${dbConfig.user}@${ld}${dbConfig.host}:${dbConfig.port}${rd}.${ld}${dbConfig.database}${rd}`;
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

  async getPool (): Promise<sql.ConnectionPool | pg.Pool | null> {
    const self = this;
    return null;
  }

  async close (): Promise<boolean> {
    const self = this;
    return true;
  }

  async closeAndExit (): Promise<void> {
    await this.close();
    process.exit(0);
  }

  async query (strSQL: string): Promise<any> {
    const self = this;
    return null;
  }

  async _getColumnsNames (): Promise<string[]> {
    const self = this;
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

  async getPortionOfData (from: TYMDms, to: TYMDms): Promise<TDbRecord[]> {
    const { tsField, ld, rd } = this;
    const strSQL = `SELECT ${this.fieldsList}
                    FROM ${this.schemaAndTable}
                    WHERE ${ld}${tsField}${rd} >= '${from}'
                      AND ${ld}${tsField}${rd} <= '${to}'
                    ORDER BY ${this.sortBy}`;
    const result = await this.query(strSQL);
    return result?.[this.recordsetPropName] || [];
  }
}
