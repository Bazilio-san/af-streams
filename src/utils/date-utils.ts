import { DateTime } from 'luxon';

const utc$ = (millis?: number): DateTime => DateTime.fromMillis(millis == null ? Date.now() : millis).setZone('UTC');
export const toUTC = (millis?: number): string => utc$(millis).toFormat('yyyy-MM-dd HH:mm:ss z');
