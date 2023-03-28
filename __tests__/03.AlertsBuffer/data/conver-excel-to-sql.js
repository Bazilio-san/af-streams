const readXlsxFile = require('read-excel-file/node');
const path = require('path');
const fs = require('fs');
const { DateTime } = require('luxon');

const excelFilePath = path.join(__dirname, 'test.xlsx');
const sqlFilePath = path.join(__dirname, 'test.sql');
const bool = (value) => (Number(value) ? 'TRUE' : 'FALSE');

const xlSerialToJsDate = (xlSerial) => new Date(-2209075200000 + (xlSerial - (xlSerial < 61 ? 0 : 1)) * 86400000);

const getInsertSQL = async () => {
  const rows = await readXlsxFile(excelFilePath);
  const values = rows.map((row) => {
    const [ts, guid, threshold, canSav2db, value, dbResult, emailSent] = row;
    if (!Number(ts)) {
      return;
    }
    return `(${[
      `'${DateTime.fromJSDate(xlSerialToJsDate(ts)).setZone('UTC').toISO()}'::timestamptz`,
      `'${`00000000-0000-0000-0000-000000000000`.substring(0, 36 - String(guid).length) + String(guid)}'`,
      bool(threshold), bool(canSav2db), Number(value), bool(dbResult), bool(emailSent)].join(', ')})`;
  }).filter(Boolean);
  return `${'INSERT'} INTO test.test 
    (ts, guid, threshold, can_save_to_db, value, saved_to_db, sent_to_email)
    VALUES \n${values.join(',\n')}`;
};

getInsertSQL().then((sql) => {
  fs.writeFileSync(sqlFilePath, sql);
});
