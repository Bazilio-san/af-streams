import { echo } from 'af-echo-ts';
import { lBlue, m, rs } from 'af-color';
import { getTimeParamFromMillis, getTimeParamMillis, isoToMillis, millisTo, TTimeUnit } from 'af-tools-ts';
import { GetNames } from './interfaces';
import { Rectifier } from './classes/applied/Rectifier';
import { setStartTimeParams, StartTimeRedis } from './StartTimeRedis';

// eslint-disable-next-line no-shadow
export enum EMailSendRule {
  IF_ALERT_NOT_EXISTS = 'IF_ALERT_NOT_EXISTS',
  BLOCK = 'BLOCK',
  FORCE = 'FORCE',
}

// eslint-disable-next-line no-shadow
export enum ETimeStartTypes {
  LAST = 'LAST',
  TIME = 'TIME',
  BEFORE = 'BEFORE',
  NOW = 'NOW'
}

export interface IStreamsParams {
  emailOneTimeSendLimit: number,
  emailSendRule: EMailSendRule,
  flushAlertsBufferIntervalSec: number,
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
  readonly timeStartBeforeValue: number,
  _timeStartBeforeUnit: TTimeUnit,
  readonly timeStartBeforeUnit: TTimeUnit,

  timeStartMillis: number,
  readonly timeStartISO: string | null,

  timeStartType: ETimeStartTypes,
  readonly timeStopISO: string | null,

  timeStopMillis: number,
}

export type IStreamsParamsConfig = Partial<IStreamsParams> & {
  isStopped?: boolean,
  isSuspended?: boolean,
};

const timeUnits = ['d', 'h', 'm', 's'];

export const PARAMS: IStreamsParams = {
  // Сигналы рассылаются пакетно. Отправляется не более этого количества писем. Остальные теряются.
  emailOneTimeSendLimit: 20,
  // Управление отправкой писем.
  emailSendRule: EMailSendRule.IF_ALERT_NOT_EXISTS,
  // Период вывода сигналов из буфера на отправку по Email и сохранение в БД.
  flushAlertsBufferIntervalSec: 3,
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

  // Параметр, устанавливающий время старта потоков, в прошлое на указанное количество миллисекунд.
  // Используется, если timeStartType = BEFORE
  // Если указано 0, то timeStartType сбрасывается в LAST
  // Если timeStartType != BEFORE, сбрасывается в 0
  timeStartBeforeMillis: 0,
  get timeStartBeforeValue () {
    const v = this.timeStartBeforeMillis;
    if (!v) {
      return 0;
    }
    const duration = getTimeParamFromMillis(v, 'biggest');
    const value = duration.split(' ')[0];
    return Number(value) || 0;
  },
  _timeStartBeforeUnit: 'h',
  get timeStartBeforeUnit () {
    const v = this.timeStartBeforeMillis;
    if (!v) {
      return this._timeStartBeforeUnit;
    }
    const duration = getTimeParamFromMillis(v, 'biggest').split(' ');
    const value = Number(duration[0]) || 0;
    if (!value) {
      return this._timeStartBeforeUnit;
    }
    let unit = duration[1] as TTimeUnit;
    unit = timeUnits.includes(unit) ? unit : 'h';
    this._timeStartBeforeUnit = unit;
    return unit;
  },

  // Параметр, устанавливающий временную метку времени старта потоков.
  // Используется, если timeStartType = TIME
  // Если указано 0, то timeStartType сбрасывается в LAST
  // - Если timeStartType = NOW, устанавливается в текущее время
  // - Если timeStartType = LAST, устанавливается на время, полученное из REDIS
  // - Если timeStartType = BEFORE, сбрасывается в 0
  // timeStartMillis: 0,

  // @ts-ignore
  t: 0, // VVR
  get timeStartMillis () {
    // @ts-ignore
    return this.t;
  },
  set timeStartMillis (v) {
    // @ts-ignore
    const o = millisTo.iso.z(this.t);
    const n = millisTo.iso.z(v);
    // @ts-ignore
    this.t = v;
    console.log('timeStartMillis', o, n);
  },

  get timeStartISO () {
    const v = this.timeStartMillis;
    return v ? millisTo.iso.z(v) : null;
  },
  // Тип старта
  timeStartType: ETimeStartTypes.LAST,

  // Время остановки потоков. Если 0 - считается, что не задано.
  timeStopMillis: 0,
  get timeStopISO () {
    const v = this.timeStopMillis;
    return v ? millisTo.iso.z(v) : null;
  },
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

const readOnlyParams = [
  'timeStartBeforeValue',
  'timeStartBeforeUnit',
  'timeStartISO',
  'timeStopISO',
];

export const changeParamByValidatedValue = (paramName: keyof IStreamsParams, value: number | boolean | EMailSendRule | ETimeStartTypes): boolean => {
  if (numberParams.includes(paramName)) {
    if (typeof value === 'number') {
      const minValue = ['loopTimeMillis', 'timeStartBeforeMillis', 'timeStartMillis', 'timeStopMillis'].includes(paramName) ? 0 : 1;
      value = Math.max(minValue, Math.ceil(value));
      const prevValue = PARAMS[paramName as keyof IStreamsParams];
      if (prevValue === value) {
        return false;
      }
      // @ts-ignore
      PARAMS[paramName] = value;
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
      if (PARAMS.emailSendRule !== value) {
        PARAMS.emailSendRule = value as EMailSendRule;
      }
      return true;
    }
    return false;
  }
  if (paramName === 'timeStartType') {
    if (Object.values(ETimeStartTypes).includes(value as ETimeStartTypes)) {
      const prevValue = PARAMS.timeStartType;
      if (prevValue === value) {
        return false;
      }
      if (PARAMS.timeStartType !== value) {
        PARAMS.timeStartType = value as ETimeStartTypes;
      }
      return true;
    }
    return false;
  }
  if (readOnlyParams.includes(paramName)) {
    return false;
  }
  // Остальные, расширенные параметры, сохраняем "как есть"
  if (JSON.stringify(PARAMS[paramName]) === JSON.stringify(value)) {
    return false;
  }
  // @ts-ignore
  PARAMS[paramName] = value;
  return true;
};

let isParamsConfigApplied = false;

export const applyParamsConfig = (streamsParamsConfig: IStreamsParamsConfig) => {
  Object.entries(streamsParamsConfig).forEach(([paramName, value]) => {
    changeParamByValidatedValue(paramName as keyof IStreamsParams, value as any);
  });
  isParamsConfigApplied = true;
};

export const applyParamsConfigOnce = (streamsParamsConfig: IStreamsParamsConfig) => {
  if (!isParamsConfigApplied) {
    applyParamsConfig(streamsParamsConfig);
  }
};

export const changeParams = async (
  params: IStreamsParamsConfig,
  rectifier: Rectifier,
  startTimeRedis: StartTimeRedis,
) => {
  if (typeof params !== 'object') {
    return;
  }

  let { timeStartBeforeValue: v, timeStartBeforeUnit: u } = params;
  if (v != null || timeUnits.includes(u || '')) {
    v = v != null ? v : PARAMS.timeStartBeforeValue;
    u = timeUnits.includes(u || '') ? u : PARAMS.timeStartBeforeUnit;
    params.timeStartBeforeMillis = getTimeParamMillis(`${v} ${u}`);
    PARAMS._timeStartBeforeUnit = u as TTimeUnit;
  }

  const { timeStartISO, timeStopISO } = params;
  if (timeStartISO != null) {
    params.timeStartMillis = isoToMillis(timeStartISO) || 0;
  }
  if (timeStopISO != null) {
    params.timeStopMillis = isoToMillis(timeStopISO) || 0;
  }

  Object.entries(params).forEach(([paramName, value]: [string, any]) => {
    if (!changeParamByValidatedValue(paramName as keyof IStreamsParams, value)) {
      delete params[paramName as keyof IStreamsParams];
      return;
    }
    echo(`Новое значение параметра ${m}${paramName}${rs} = ${lBlue}${JSON.stringify(value)}`);
    // Дополнительные действия по парамерам
    if (paramName === 'rectifierSendIntervalMillis' && rectifier) {
      rectifier.resetRectifierSendInterval();
    }
  });
  const wasTimeStartParams = Object.entries(params).some(([paramName, paramValue]) => paramName.startsWith('timeSt') && paramValue != null);

  if (wasTimeStartParams) {
    if (startTimeRedis) {
      await startTimeRedis.defineStartTime();
    } else {
      setStartTimeParams();
    }
  }
};
