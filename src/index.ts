export { IStreamConstructorOptions, Stream } from './Stream';
export { LastTimeRecords } from './LastTimeRecords';
export { RecordsBuffer } from './RecordsBuffer';
export { IStartTimeRedisOptions, StartTimeRedis } from './StartTimeRedis';
export { getVirtualTimeObj, IVirtualTimeObjOptions, VirtualTimeObj } from './VirtualTimeObj';
export {
  TDbRecord, TEventRecord, IDbConfig, TSlot,
  IEmPortionOfDataCount, IEmPortionOfDataSql,
  IEmVirtualHourChanged, IEmVirtualDateChanged,
  IEmSubtractedLastTimeRecords, IEmCurrentLastTimeRecords,
  IEmBeforeLoadNextPortion, IEmAfterLoadNextPortion, IEmSaveLastTs,
  EWinInsertType, ISocket, IOFnArgs,
} from './interfaces';
export {
  getTimeParamMillis,
  getTimeParamFromMillis,
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
export { TS_FIELD, STREAM_ID_FIELD, DEFAULTS } from './constants';

// =============================== CLASSES =====================================
export {
  NumberWindow,
  INumberWindowItem,
  INumberWindowSetStatOptions,
  INumberWindowConstructorOptions,
} from './classes/base/NumberWindow';

export {
  SingleEventTimeWindow,
  ISingleEventTimeWindowSetStatOptions,
  ISingleEventTimeWindowConstructorOptions,
} from './classes/base/SingleEventTimeWindow';

export {
  TimeWindow,
  ITimeWindowItem,
  ITimeWindowSetStatOptions,
  ITimeWindowConstructorOptions,
} from './classes/base/TimeWindow';

export {
  KeyedNumberWindow,
  IKeyedNumberWindowHash,
  IKeyedNumberWindowOptions,
} from './classes/keyed/KeyedNumberWindow';

export {
  KeyedSingleEventTimeWindow,
  IKeyedSingleEventTimeWindowConstructorOptions,
} from './classes/keyed/KeyedSingleEventTimeWindow';

export {
  KeyedTimeWindow,
  IKeyedTimeWindowHash,
  IKeyedTimeWindowInfo,
  IKeyedTimeWindowOptions,
} from './classes/keyed/KeyedTimeWindow';

export {
  Rectifier,
  IRectifierOptions,
} from './classes/applied/Rectifier';

export {
  SimpleEventEmitterAsyncQueue,
  ISimpleEventEmitterQueueConstructorOptions,
} from './classes/applied/SimpleEventEmitterAsyncQueue';

export { streamsManager, StreamsManager, IPrepareRectifierOptions } from './manager/streams-manager';
