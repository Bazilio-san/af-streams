import { TAlert, TMergeResult } from '../../src';
import { ACTIONS_TABLE, ALERT_TABLE, query, TEST_SCHEMA } from './db';
import { millisToPgUtc } from './test-utils';

const AT = `${TEST_SCHEMA}.${ALERT_TABLE}`;
const AA = `${TEST_SCHEMA}.${ACTIONS_TABLE}`;

/**
 * Запись сигналов в таблицу БД
 */
export const mergeAlerts = async (alerts: TAlert[]): Promise<TMergeResult> => {
  const now = Date.now();
  const values = alerts.map((a: TAlert) => `('${a.guid}', ${a.alertTypeId}, ${millisToPgUtc(a.ts)}, '${JSON.stringify(a.info_json)}', ${millisToPgUtc(now)}  )`).join(', \n');
  const mergeSQL = `${'INSERT'}INTO ${AT}  (guid, "alertTypeId", ts, info_json, "updatedAt")
    VALUES ${values}
    ON CONFLICT (guid) DO UPDATE SET
        "alertTypeId" = EXCLUDED."alertTypeId",
        ts = EXCLUDED.ts,
        info_json = EXCLUDED.info_json,
        "updatedAt" = EXCLUDED."updatedAt"
    RETURNING *`;
  const res = await query(mergeSQL);
  return res?.rows[0];
};

/**
 * Проверяет наличие сигнала в БД
 */
export const checkAlertExists = async (guid: string): Promise<boolean> => {
  const res = await query(`${'SELECT'} guid FROM ${AT} WHERE guid = '${guid}'`);
  return Boolean(res?.rowCount);
};

export const mergeAlertsActions = async (guids: string[], operationIds: number[]): Promise<void> => {
  const values = guids.map((guid) => `('${guid}', '${JSON.stringify({ toProc: operationIds })}')`).join(',\n');
  const strSQL = `
    ${'INSERT'} INTO ${AA} (guid, actions)
    VALUES ${values}
    ON CONFLICT (guid) DO UPDATE SET
        actions = EXCLUDED.actions
    RETURNING *`;
  await query(strSQL);
};
