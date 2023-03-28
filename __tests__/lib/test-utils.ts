import * as fsPath from 'path';
import { DateTime } from 'luxon';

export const normalizePath = (path: string) => fsPath.normalize(fsPath.resolve(path.replace(/[/\\]+/g, '/'))).replace(/\\/g, '/');

const utc$ = (millis?: number): DateTime => DateTime.fromMillis(millis == null ? Date.now() : millis).setZone('UTC');
export const millisToPgUtc = (millis?: number) => `'${utc$(millis).toISO()}'::timestamptz`;
export const millisToISO = (millis?: number) => utc$(millis).toISO();
