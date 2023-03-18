/* eslint-disable no-console */
import { reset, underlineOff } from './color';

export const echo = (msg: string) => {
  const prefix = '';
  console.log(`\x1b[49;39m${underlineOff}${prefix}${msg}${reset}`);
};
