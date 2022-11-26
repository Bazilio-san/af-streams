import { IDbConstructorOptions } from '../@types/interfaces';
import { DbMsSql } from './DbMsSql';
import { DbPostgres } from './DbPostgres';

const getDb = async (options: IDbConstructorOptions): Promise<DbMsSql | DbPostgres> => {
  let db: DbMsSql | DbPostgres;
  if (options.dbConfig.dialect === 'mssql') {
    db = new DbMsSql(options);
  } else {
    db = new DbPostgres(options);
  }
  await db.init();
  return db;
};

export default getDb;
