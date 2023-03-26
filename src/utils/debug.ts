import { DateTime } from 'luxon';
import { c } from './color';
import { echoSimple } from './echo-simple';

export const DEBUG = (String(process.env.DEBUG || '')).trim();
export const IS_TOTAL_DEBUG = DEBUG === '*';

export const dbg = (str: string) => {
  echoSimple(`${DateTime.now().setZone('UTC').toFormat('HH:mm:ss')} ${c}${str}`);
};

export const getDbgRe = (debugPattern: string) => new RegExp(`\\b${debugPattern}\\b`, 'i');

export function Debug (debugPattern: string) {
  function debug (msg: string) {
    if (debug.enabled) {
      echoSimple(`${DateTime.now().setZone('UTC').toFormat('HH:mm:ss')} ${c}${msg}`);
    }
  }

  debug.enabled = IS_TOTAL_DEBUG || (getDbgRe(debugPattern)).test(DEBUG);
  return debug;
}
