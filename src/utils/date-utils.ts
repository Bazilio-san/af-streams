import { DateTime } from 'luxon';
import { ToISOTimeOptions } from 'luxon/src/datetime';

const utc$ = (millis?: number): DateTime => DateTime.fromMillis(millis == null ? Date.now() : millis).setZone('UTC');
export const toUTC = (millis?: number): string => utc$(millis).toFormat('yyyy-MM-dd HH:mm:ss z');
export const toUTC_ = (millis?: number): string => utc$(millis).toFormat('yyyy-MM-dd HH:mm:ss');

// 2022-05-15T16:56:42.349Z
export const millis2isoZ = (millis: number, options?: ToISOTimeOptions): string => utc$(millis).toISO(options);

// 2022-05-15T19:56:42.349+03:00
export const millis2iso = (millis: number, options?: ToISOTimeOptions): string => DateTime.fromMillis(millis).toISO(options);
