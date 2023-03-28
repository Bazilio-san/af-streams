import * as fs from 'fs';
import * as path from 'path';
import { ACTIONS_TABLE, ALERT_TABLE, getPool, query, TEST_DB, TEST_SCHEMA, TEST_TABLE } from '../../lib/db';
import { echo } from '../../lib/logger';

const TT = `${TEST_SCHEMA}.${TEST_TABLE}`;
const AT = `${TEST_SCHEMA}.${ALERT_TABLE}`;
const AA = `${TEST_SCHEMA}.${ACTIONS_TABLE}`;

export const initTestDbEnvironment = async () => {
  const pool = await getPool();
  if (!pool) {
    throw new Error('Не удалось установить соединение с тестовой БД');
  }

  echo(`Создаю БД ${TEST_DB}, если такой еще нет`);
  let sql = `SELECT TRUE as "exists"
             FROM pg_database
             WHERE datname = '${TEST_DB}'`;
  const result = await query(sql);
  if (!result?.rows?.length) {
    sql = `CREATE DATABASE '${TEST_DB}'`;
    await query(sql);
  }
  echo(`OK!`);

  echo(`Создаю схему БД ${TEST_SCHEMA}`);
  sql = `CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA} AUTHORIZATION postgres;
  comment on schema ${TEST_SCHEMA} is 'For tests of af-streams'`;
  await query(sql);
  echo(`OK!`);

  echo(`Пересоздаю тестовую таблицу`);
  sql = `
      DROP TABLE IF EXISTS ${TT};
      CREATE TABLE ${TT}
      (
          ts             timestamp with time zone not null,
          guid           uuid                     not null,
          threshold      boolean                  not null,
          can_save_to_db boolean                  not null,
          value          integer                  not null,
          saved_to_db    boolean                  not null,
          sent_to_email  boolean                  not null
      );
      CREATE INDEX test_ts_index on ${TT} (ts);
  `;
  await query(sql);
  echo(`OK!`);

  echo(`Добавляю данные в тестовую таблицу`);
  const sqlFilePath = path.normalize(path.join(__dirname, '../data/test.sql'));
  sql = fs.readFileSync(sqlFilePath, 'utf-8');
  await query(sql);
  echo(`OK!`);

  echo(`Пересоздаю таблицу сигналов`);
  sql = `
      DROP TABLE IF EXISTS ${AT};
      CREATE TABLE ${AT}
      (
          guid uuid not null
              constraint alert_pk
                  primary key,
          "alertTypeId" integer not null,
          ts timestamp with time zone not null,
          info_json jsonb not null,
          "updatedAt" timestamp with time zone not null
      );
  `;
  await query(sql);
  echo(`OK!`);

  echo(`Пересоздаю таблицу действий операторов`);
  sql = `
      DROP TABLE IF EXISTS ${AA};
      CREATE TABLE ${AA}
      (
          guid   uuid NOT NULL constraint alert_actions_pk primary key,
          actions     jsonb,
          "createdAt" timestamp with time zone default now()
      );
  `;
  await query(sql);
  echo(`OK!`);
};
