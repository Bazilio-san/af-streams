import { echo } from 'af-echo-ts';
import { lBlue, m, rs } from 'af-color';
import { GetNames } from './interfaces';
import { Rectifier } from './classes/applied/Rectifier';
import { VirtualTimeObj } from './VirtualTimeObj';

// eslint-disable-next-line no-shadow
export enum EMailSendRule {
  IF_ALERT_NOT_EXISTS = 'IF_ALERT_NOT_EXISTS',
  BLOCK = 'BLOCK',
  FORCE = 'FORCE'
}

export interface IParams {
  emailOneTimeSendLimit: number,
  emailSendRule: EMailSendRule,
  flushAlertsBufferIntervalSec: number,
  isUsedSavedStartTime: boolean,
  loopTimeMillis: number,
  maxRunUpFirstTsVtMillis: number,
  printInfoIntervalSec: number,
  processHistoricalAlerts: boolean,
  rectifierAccumulationTimeMillis: number,
  rectifierSendIntervalMillis: number,
  saveExactLastTsToRedis: boolean,
  skipGaps: boolean,
  speed: number,
  streamBufferMultiplier: number,
  streamFetchIntervalSec: number,
  streamMaxBufferSize: number,
  streamSendIntervalMillis: number,
  timeFrontUpdateIntervalMillis: number,
  timeStartBeforeMillis: number,
  timeStartMillis: number,
  timeStartTakeFromRedis: boolean,
  timeStopMillis: number,
  printEveryRemovedItemFromKeyedSingleEventTimeWindow: boolean,
}

export type IParamsConfig = Partial<IParams>;

export const PARAMS: IParams = {
  // Сигналы рассылаются пакетно. Отправляется не более этого количества писем. Остальные теряются.
  emailOneTimeSendLimit: 20,
  // Управление отправкой писем.
  emailSendRule: EMailSendRule.IF_ALERT_NOT_EXISTS,
  // Период вывода сигналов из буфера на отправку по Email и сохранение в БД.
  flushAlertsBufferIntervalSec: 3,
  // Информационный параметр, который устанавливается в классе StartTimeRedis
  isUsedSavedStartTime: false,
  // Время, через который виртуальное время возвращается к начальному. Используется при циклическом тестировании.
  loopTimeMillis: 0,
  // Не допускаем увеличение разницы между ts первого элемента и виртуальным временем боле, чем на это значение
  maxRunUpFirstTsVtMillis: 2_000,
  // Периодичность печати минимальной статистики потоков в консоль
  printInfoIntervalSec: 60,
  // false - НЕ Записывать исторические сигналы в БД и не отправлять по ним EMAIL
  processHistoricalAlerts: false,
  // Время, в пределах которого происходит аккумуляция и выпрямление событий.
  rectifierAccumulationTimeMillis: 60_000,
  // Периодичность отправки ts-объектов, время которых старше <virtualTs> - <rectifierAccumulationTimeMillis>
  rectifierSendIntervalMillis: 10,

  // Режим сохранения последнего достигнутого потоками времени в Redis.
  // true - сохранение метки времени последнего события в пакете после обработки
  // очередного пакета событий потока. С частотой streamSendIntervalMillis (часто).
  // false - сохранение временного фронта перед обработкой очередной загруженной
  // порции данных каждым из потоков. Происходит с частотой streamFetchIntervalSec * кол-во потоков (редко)
  // Режим true нужно использовать осторожно и только в случае, если поток один.
  saveExactLastTsToRedis: false,

  // Пропуск нерабочего времени. Включается в режиме тестирования при обработке истории
  skipGaps: false,
  // Скорость течения виртуального времени
  speed: 1,
  // Запрос данных со сдвигом виртуального времени на streamBufferMultiplier интервалов опроса
  streamBufferMultiplier: 2,
  // Частота запросов в БД для выборки данных для потоков
  streamFetchIntervalSec: 10,
  // Ограничение на количество записей в буфере. Если буфер пуст, то это же
  // значение станет ограничением на кол-во записей, выбираемых в одном запросе в БД.
  // Если буфер не пуст, то условие выборки (TOP/LIMIT) уменьшается на количество записей в буфере.
  streamMaxBufferSize: 65_000,
  // The interval for sending data from the buffer
  streamSendIntervalMillis: 10,
  // Частота обновления фронта виртуального времени
  timeFrontUpdateIntervalMillis: 5,
  // Параметр, устанавливающий время старта потоков, в прошлое на указанное
  // количество миллисекунд. Если указано число больше 0, то этот параметр
  // имеет приоритет над timeStartMillis
  timeStartBeforeMillis: 0,
  // Параметр, устанавливающий временную метку времени старта потоков.
  // Если 0 - то потоки стартуют с текущего времени.
  // Значение не учитывается, если timeStartTakeFromRedis = true
  timeStartMillis: 0,
  // Получать время старта потоков из Redis.
  // Если true, прочие параметры установки начального времени игнорируются
  timeStartTakeFromRedis: true,
  // Время остановки потоков. Если 0 - считается, что не задано.
  timeStopMillis: 0,
  //
  printEveryRemovedItemFromKeyedSingleEventTimeWindow: false,
};

const numberParams = [
  'emailOneTimeSendLimit',
  'flushAlertsBufferIntervalSec',
  'loopTimeMillis',
  'maxRunUpFirstTsVtMillis',
  'printInfoIntervalSec',
  'rectifierAccumulationTimeMillis',
  'rectifierSendIntervalMillis',
  'speed',
  'streamBufferMultiplier',
  'streamFetchIntervalSec',
  'streamMaxBufferSize',
  'streamSendIntervalMillis',
  'timeFrontUpdateIntervalMillis',
  'timeStartBeforeMillis',
  'timeStartMillis',
  'timeStopMillis',
];

const booleanParams = [
  'processHistoricalAlerts',
  'skipGaps',
  'timeStartTakeFromRedis',
];

export const setValidatedParam = (paramName: keyof IParams, value: number | boolean | EMailSendRule): boolean => {
  if (numberParams.includes(paramName)) {
    if (typeof value === 'number') {
      type NumberKeys = GetNames<IParams, number>;
      const minValue = ['loopTimeMillis', 'timeStartBeforeMillis', 'timeStartMillis', 'timeStopMillis'].includes(paramName) ? 0 : 1;
      value = Math.max(minValue, Math.ceil(value));
      PARAMS[paramName as NumberKeys] = value;
      return true;
    }
    return false;
  }
  if (booleanParams.includes(paramName)) {
    if (typeof value === 'boolean') {
      type BooleanKeys = GetNames<IParams, boolean>;
      PARAMS[paramName as BooleanKeys] = value;
      return true;
    }
    return false;
  }
  if (paramName === 'emailSendRule') {
    if (Object.values(EMailSendRule).includes(value as EMailSendRule)) {
      PARAMS.emailSendRule = value as EMailSendRule;
      return true;
    }
    return false;
  }
  return false;
};

let isParamsConfigApplied = false;

export const applyParamsConfig = (paramsConfig: IParamsConfig) => {
  Object.entries(paramsConfig).forEach(([paramName, value]) => {
    setValidatedParam(paramName as keyof IParams, value);
  });
  isParamsConfigApplied = true;
};

export const applyParamsConfigOnce = (paramsConfig: IParamsConfig) => {
  if (!isParamsConfigApplied) {
    applyParamsConfig(paramsConfig);
  }
};

export const changeParams = (
  paramsConfig: IParamsConfig,
  virtualTimeObj: VirtualTimeObj,
  rectifier: Rectifier,
) => {
  if (typeof paramsConfig !== 'object') {
    return;
  }
  Object.entries(paramsConfig).forEach(([paramName, value]: [string, any]) => {
    if (!setValidatedParam(paramName as keyof IParams, value)) {
      return;
    }
    echo(`Новое значение параметра ${m}${paramName}${rs} = ${lBlue}${value}`);
    // Дополнительные действия по парамерам
    if (paramName === 'rectifierSendIntervalMillis' && rectifier) {
      rectifier.resetRectifierSendInterval();
    }
  });
};
