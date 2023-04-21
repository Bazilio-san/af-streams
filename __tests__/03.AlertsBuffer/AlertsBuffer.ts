import { bg, bk, g, lBlue, lCyan, rs, yellow } from 'af-color';
import { echo } from 'af-echo-ts';
import { initStreams, streamsManager } from './src/init-stream';
import { initTestDbEnvironment } from './src/init-test-db';
import eventEmitter from '../lib/ee';
import { IEmPortionOfDataCount } from '../../src';

const getPrefix = (streamId: string, msgIg: string = ''): string => {
  const clr = streamId.endsWith('A') ? yellow : lBlue;
  return `${lCyan}STREAM: ${clr}${streamId}: ${lCyan}${msgIg}${rs}`;
};
eventEmitter.on('get-portion-of-data-count', ({ streamId, count, sql }: IEmPortionOfDataCount) => {
  const pfx = getPrefix(streamId, 'Portion of data');
  echo(`${pfx}: ${bg.yellow}${bk}${count}${rs} records. SQL:\n${g}${sql}`);
});

const forceStopISO = '2023-02-02';

const start = async () => {
  await initTestDbEnvironment();
  await initStreams();
  await streamsManager.start();
  return new Promise((resolve: Function) => {
    const timer = setInterval(() => {
      const currISO = streamsManager.virtualTimeObj.virtualTimeISO || forceStopISO;
      if (currISO >= '2023-01-02T00:00:10') {
        clearInterval(timer);
        resolve();
      }
    }, 5);
  });
};

start().then(() => {
  process.exit();
});
