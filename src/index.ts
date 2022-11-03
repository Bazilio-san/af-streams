export { IStreamConstructorOptions, Stream } from './Stream';
export { LastTimeRecords } from './LastTimeRecords';
export { RecordsBuffer } from './RecordsBuffer';
export { IStartTimeRedisOptions, StartTimeRedis } from './StartTimeRedis';
export { getVirtualTimeObj, IVirtualTimeObjOptions, VirtualTimeObj } from './VirtualTimeObj';
export { TDbRecord, TEventRecord, IDbConfig, TSlot, IVirtualDateChanged, IVirtualHourChanged } from './interfaces';
export {
  getTimeParamMillis,
  timeParamRE,
  padL,
  padR,
  sleep,
} from './utils/utils';
export {
  findIndexOfNearestSmallerLEFT,
  findIndexOfNearestSmallerRIGHT,
  findIndexOfNearestSmallerBINARY,
  findIndexOfNearestSmaller,
  // Deprecated
  findIndexOfNearestSmallerLEFT as findSmallestIndexLinear, // compatibility
  // Deprecated
  findIndexOfNearestSmallerRIGHT as findIndexOfNearestSmallFromRight, // compatibility
  // Deprecated
  findIndexOfNearestSmallerBINARY as findSmallestIndexBinary, // compatibility
  // Deprecated
  findIndexOfNearestSmaller as findSmallestIndex, // compatibility
} from './utils/find-index-of-nearest-smaller';
export {
  findIndexOfNearestSmallerInNumArrayLEFT,
  findIndexOfNearestSmallerInNumArrayRIGHT,
  findIndexOfNearestSmallerInNumArrayBINARY,
  findIndexOfNearestSmallerInNumArray,
} from './utils/find-index-of-nearest-smaller-in-num-array';
export {
  findSlotIntLEFT,
  findSlotIntRIGHT,
  findSlotIntBINARY,
  findSlotInt,
} from './utils/find-slot-int';
export {
  findSlotFloatLEFT,
  findSlotFloatRIGHT,
  findSlotFloatBINARY,
  findSlotFloat,
} from './utils/find-slot-float';
export { TS_FIELD } from './constants';
