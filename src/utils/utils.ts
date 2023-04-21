import { getInstanceKey, getTimeParamMillis, timeParamRE } from 'af-tools-ts';
import { DateTime } from 'luxon';
import { echo } from 'af-echo-ts';
import { PARAMS } from '../params';

export const getStreamKey = (stringId: string) => getInstanceKey() + stringId;
export const capitalizeFirstLetter = (s: string) => s[0].toUpperCase() + s.substring(1);

// !!!Attention!!! STREAM_TIME_START - time in GMT
export const setStartTimeParamsFromENV = () => {
  const { STREAM_TIME_START = '', STREAM_TIME_START_BEFORE = '' } = process.env;
  if (STREAM_TIME_START_BEFORE) {
    if (timeParamRE.test(STREAM_TIME_START_BEFORE)) {
      PARAMS.timeStartBeforeMillis = getTimeParamMillis(STREAM_TIME_START_BEFORE);
      PARAMS.timeStartMillis = Date.now() - PARAMS.timeStartBeforeMillis;
      return;
    }
    echo.error(`Start time is incorrect. STREAM_TIME_START_BEFORE: ${STREAM_TIME_START_BEFORE}`);
  }

  if (STREAM_TIME_START) {
    const dt = DateTime.fromISO(STREAM_TIME_START, { zone: 'GMT' });
    if (dt.isValid) {
      PARAMS.timeStartBeforeMillis = 0;
      PARAMS.timeStartMillis = dt.toMillis();
      return;
    }
    echo.error(`Start time is incorrect. STREAM_TIME_START: ${STREAM_TIME_START}`);
  }
  PARAMS.timeStartBeforeMillis = 0;
  PARAMS.timeStartMillis = 0;
};
