import { TAlert, TMergeResult } from '../../src';
import { ALERT_TABLE, query, TEST_SCHEMA } from './db';
import { millisToPgUtc } from './test-utils';

const AT = `${TEST_SCHEMA}.${ALERT_TABLE}`;

/**
 * Запись сигналов в таблицу БД
 */
export const mergeAlerts = async (alerts: TAlert[]): Promise<TMergeResult> => {
  const now = Date.now();
  const values = alerts.map((a: TAlert) => `('${a.guid}', ${a.alertTypeId}, ${millisToPgUtc(a.ts)}, '${JSON.stringify(a.info_json)}', ${millisToPgUtc(now)}  )`).join(', \n');
  const mergeSQL = `${'INSERT'} INTO ${AT}  (guid, "alertTypeId", ts, info_json, "updatedAt")
    VALUES ${values}
    ON CONFLICT (guid) DO UPDATE SET
        "alertTypeId" = EXCLUDED."alertTypeId",
        ts = EXCLUDED.ts,
        info_json = EXCLUDED.info_json,
        "updatedAt" = EXCLUDED."updatedAt"
    RETURNING *`;
  const res = await query(mergeSQL);
  const total = res?.rows?.length || 0;
  const inserted = res?.rows?.length || 0;
  const updated = 0;
  return { total, inserted, updated };
};

/**
 * Проверяет наличие сигнала в БД
 */
export const checkAlertExists = async (guid: string): Promise<boolean> => {
  const res = await query(`${'SELECT'} guid FROM ${AT} WHERE guid = '${guid}'`);
  return Boolean(res?.rowCount);
};
