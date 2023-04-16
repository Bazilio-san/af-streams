import { START_OF_ERA_ISO } from 'af-tools-ts';
import { initStreams, streamsManager } from './src/init-stream';
import { initTestDbEnvironment } from './src/init-test-db';

const runTestStream = async (): Promise<void> => {
  await streamsManager.start();
  return new Promise((resolve: Function) => {
    const timer = setInterval(() => {
      if ((streamsManager.virtualTimeObj.virtualTimeISO || START_OF_ERA_ISO) >= '2023-01-02T00:00:10') {
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
    expect(alertsStat.sentByEmail.total).toBe(3);
    expect(alertsStat.addedToBuffer.total).toBe(62);
    expect(alertsStat.savedToDb.all.total.t).toBe(2);
  });
});
