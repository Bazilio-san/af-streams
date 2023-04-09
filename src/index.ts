export { IStreamConstructorOptions, Stream } from './Stream';
export { LastTimeRecords } from './LastTimeRecords';
export { RecordsBuffer } from './RecordsBuffer';
export { StartTimeRedis } from './StartTimeRedis';
export { getVirtualTimeObj, IVirtualTimeObjOptions, VirtualTimeObj } from './VirtualTimeObj';
export {
  TDbRecord, TEventRecord, IDbConfig, TSlot,
  IEmPortionOfDataCount, IEmPortionOfDataSql,
  IEmVirtualHourChanged, IEmVirtualDateChanged,
  IEmSubtractedLastTimeRecords, IEmCurrentLastTimeRecords,
  IEmBeforeLoadNextPortion, IEmAfterLoadNextPortion, IEmSaveLastTs,
  EWinInsertType, ISocket, IOFnArgs, ICommonConfig, IVirtualTimeConfig,
  ISenderConfig, IStreamConfig, IStartTimeConfig,
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

export { StreamsManager, IPrepareRectifierOptions, IPrepareAlertsBufferOptions, IPrepareStreamOptions } from './manager/streams-manager';

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

export {
  EMailSendRule,
  isDeprecatedSendAlertsByEmail,
  getEmailSendRule,
  reloadStreamsEnv,
  canSaveHistoricalAlerts,
} from './alerts-buffer/constants';

export { AlertsStat, IStatTT, IStatTTtiu, TIU, getAlertsStat } from './alerts-buffer/AlertsStat';

export { AlertsBuffer } from './alerts-buffer/AlertsBuffer';

export {
  traverse,
  ITraverseNode,
  flattenObjectPrimitiveLeafs,
  fillSubjectTemplate,
  removeHTML,
  jsonToHtml,
  fillHtmlTemplate,
  htmlTemplate,
  TFillHtmlTemplateArgs,
  alertEmailDetails,
  alertEmailHeader,
  alertEmailFooter,
} from './alerts-buffer/utils/utils';

export { ISendAlertArgs, getSendMail } from './alerts-buffer/utils/email-service';
