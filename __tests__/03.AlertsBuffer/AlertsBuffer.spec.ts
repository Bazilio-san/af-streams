import { initStreams, streamsManager } from './src/init-stream';
import { initTestDbEnvironment } from './src/init-test-db';

const forceStopISO = '2023-02-02';

const runTestStream = async (): Promise<void> => {
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

describe('Test AlertsBuffer', () => {
  beforeAll(async () => {
    await initTestDbEnvironment();
    await initStreams();
    await runTestStream();
  });
  test('test 2', async () => {
    const { alertsStat } = streamsManager.alertsBuffer;
    expect(alertsStat.sentByEmail.all.total).toBe(3);
    expect(alertsStat.addedToBuffer.all.total).toBe(62);
    expect(alertsStat.savedToDb.all.total.t).toBe(2);
  });
});
