import { echo } from 'af-echo-ts';
import { lBlue, m, rs } from 'af-color';
import { GetNames } from './interfaces';
import { Rectifier } from './classes/applied/Rectifier';

// eslint-disable-next-line no-shadow
export enum EMailSendRule {
  IF_ALERT_NOT_EXISTS = 'IF_ALERT_NOT_EXISTS',
  BLOCK = 'BLOCK',
  FORCE = 'FORCE'
}

export interface IStreamsParams {
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
  saveExactLastTimeToRedis: boolean,
  skipGaps: boolean,
  speed: number,
  streamBufferMultiplier: number,
  streamFetchIntervalSec: number,
  streamMaxBufferSize: number,
  streamSendIntervalMillis: number,
  timeFrontUpdateIntervalMillis: number,
  timeStartBeforeMillis: number,
  timeStartMillis: number,
  timeStopMillis: number,
}

export type IStreamsParamsConfig = Partial<IStreamsParams> & {
  isStopped?: boolean,
  isSuspended?: boolean,
};

export const PARAMS: IStreamsParams = {
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
  // true - С частотой streamSendIntervalMillis (часто) производится сохранение
  // метки времени последнего события в пакете,
  // ПОСЛЕ обработки ОЧЕРЕДНОГО ПАКЕТА событий потока.
  //
  // false - С частотой streamFetchIntervalSec * кол-во потоков (редко)
  // производится сохранение ВРЕМЕННОГО ФРОНТА
  // перед обработкой очередной загруженной порции данных каждым из потоков
  // Режим true нужно использовать осторожно и только в случае, если поток один.
  saveExactLastTimeToRedis: false,

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
  // Если 0 и timeStartBeforeMillis = 0, время берется из redis. А если там нет, то берется текущее время
  timeStartMillis: 0,
  // Время остановки потоков. Если 0 - считается, что не задано.
  timeStopMillis: 0,
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
];

export const changeParamByValidatedValue = (paramName: keyof IStreamsParams, value: number | boolean | EMailSendRule): boolean => {
  if (numberParams.includes(paramName)) {
    if (typeof value === 'number') {
      type NumberKeys = GetNames<IStreamsParams, number>;
      const minValue = ['loopTimeMillis', 'timeStartBeforeMillis', 'timeStartMillis', 'timeStopMillis'].includes(paramName) ? 0 : 1;
      value = Math.max(minValue, Math.ceil(value));
      const prevValue = PARAMS[paramName as NumberKeys];
      if (prevValue === value) {
        return false;
      }
      PARAMS[paramName as NumberKeys] = value;
      return true;
    }
    return false;
  }
  if (booleanParams.includes(paramName)) {
    if (typeof value === 'boolean') {
      type BooleanKeys = GetNames<IStreamsParams, boolean>;
      const prevValue = PARAMS[paramName as BooleanKeys];
      if (prevValue === value) {
        return false;
      }
      PARAMS[paramName as BooleanKeys] = value;
      return true;
    }
    return false;
  }
  if (paramName === 'emailSendRule') {
    if (Object.values(EMailSendRule).includes(value as EMailSendRule)) {
      const prevValue = PARAMS.emailSendRule;
      if (prevValue === value) {
        return false;
      }
      PARAMS.emailSendRule = value as EMailSendRule;
      return true;
    }
    return false;
  }
  // Остальные, расширенные параметры, сохраняем "как есть"
  // @ts-ignore
  if (JSON.stringify(PARAMS[paramName]) === JSON.stringify(PARAMS[value])) {
    return false;
  }
  // @ts-ignore
  PARAMS[paramName] = value;
  return false;
};

let isParamsConfigApplied = false;

export const applyParamsConfig = (streamsParamsConfig: IStreamsParamsConfig) => {
  Object.entries(streamsParamsConfig).forEach(([paramName, value]) => {
    changeParamByValidatedValue(paramName as keyof IStreamsParams, value);
  });
  isParamsConfigApplied = true;
};

export const applyParamsConfigOnce = (streamsParamsConfig: IStreamsParamsConfig) => {
  if (!isParamsConfigApplied) {
    applyParamsConfig(streamsParamsConfig);
  }
};

export const changeParams = (
  streamsParamsConfig: IStreamsParamsConfig,
  rectifier: Rectifier,
) => {
  if (typeof streamsParamsConfig !== 'object') {
    return;
  }
  Object.entries(streamsParamsConfig).forEach(([paramName, value]: [string, any]) => {
    if (!changeParamByValidatedValue(paramName as keyof IStreamsParams, value)) {
      return;
    }
    echo(`Новое значение параметра ${m}${paramName}${rs} = ${lBlue}${JSON.stringify(value)}`);
    // Дополнительные действия по парамерам
    if (paramName === 'rectifierSendIntervalMillis' && rectifier) {
      rectifier.resetRectifierSendInterval();
    }
  });
};
