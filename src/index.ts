export { IStreamConstructorOptions, Stream } from './Stream';
export { LastTimeRecords } from './LastTimeRecords';
export { RecordsBuffer } from './RecordsBuffer';
export {
  StartTimeRedis,
  setStartTimeParamsFromENV,
  StartTimeRedisConstructorOptions,
  getStartTimeRedis,
} from './StartTimeRedis';
export { getVirtualTimeObj, VirtualTimeObj } from './VirtualTimeObj';
export {
  TDbRecord, TEventRecord, IDbConfig, TSlot,
  IEmPortionOfDataCount, IEmPortionOfDataSql,
  IEmVirtualHourChanged, IEmVirtualDateChanged,
  IEmSubtractedLastTimeRecords, IEmCurrentLastTimeRecords,
  IEmBeforeLoadNextPortion, IEmAfterLoadNextPortion, IEmSaveLastTs,
  EWinInsertType, ISocket, IOFnArgs, ICommonConfig,
  ISenderConfig, IStreamConfig, IRedisConfig,
} from './interfaces';

export {
  findIndexOfNearestSmallerLEFT,
  findIndexOfNearestSmallerRIGHT,
  findIndexOfNearestSmallerBINARY,
  findIndexOfNearestSmaller,
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

export {
  TS_FIELD,
  STREAM_ID_FIELD,
} from './constants';

export {
  PARAMS,
  EMailSendRule,
  IStreamsParams,
  changeParams,
  IStreamsParamsConfig,
  applyParamsConfig,
  applyParamsConfigOnce,
  setValidatedParam,
} from './params';

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

export { StreamsManager } from './manager/streams-manager';
export { IPrepareRectifierOptions, IPrepareAlertsBufferOptions, IPrepareStreamOptions } from './manager/i';

// AlertsBuffer

export {
  TAlert,
  IAlertEmailSettings,
  TAlertEmailDetails,
  TAlertsBufferRequired,
  TAlertSentFlags,
  TAlertTableRecord,
  TMergeResult,
} from './alerts-buffer/i-alert';

export { AlertsStat, IStatTT, IStatTTtiu, TIU } from './alerts-buffer/AlertsStat';

export { AlertsBuffer } from './alerts-buffer/AlertsBuffer';

export {
  jsonToHtml,
  fillHtmlTemplate,
  htmlTemplate,
  TFillHtmlTemplateArgs,
  alertEmailDetails,
  alertEmailHeader,
  alertEmailFooter,
} from './alerts-buffer/lib/utils';

export { ISendAlertArgs, getSendMail } from './alerts-buffer/lib/email-service';
export { startUpStreamsInfo } from './utils/startup-streams-info';
