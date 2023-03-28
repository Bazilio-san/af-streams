import { initStreams, streamsManager } from './src/init-stream';
import { Stream } from '../../src';
import { initTestDbEnvironment } from './src/init-test-db';

let stream: Stream;
let streams: Stream[];
let startStreamTs: number;
let procTs: number;

const runTestStream = async (): Promise<void> => {
  streams = await streamsManager.start();
  startStreamTs = Date.now();
  stream = streams[0];
  return new Promise((resolve: Function) => {
    const timer = setInterval(() => {
      if (streamsManager.virtualTimeObj.virtualTimeISO >= '2023-01-02T00:01:00') {
        clearInterval(timer);
        procTs = Date.now() - startStreamTs;
        resolve();
      }
    }, 5);
  });
};

describe('Test AlertsBuffer', () => {
  beforeAll(async () => {
    await initTestDbEnvironment();
    await initStreams();
    await runTestStream();
  });
  test('test 2', async () => {
    expect(streamsManager.alertsBuffer).toBeTruthy();
    expect(procTs).toBeGreaterThan(10_000);
  });
});
