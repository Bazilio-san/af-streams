// eslint-disable-next-line no-shadow
export enum EMailSendRule {
  IF_ALERT_NOT_EXISTS = 'IF_ALERT_NOT_EXISTS',
  BLOCK = 'BLOCK',
  FORCE = 'FORCE'
}

const data = {
  emailSendRule: EMailSendRule.IF_ALERT_NOT_EXISTS,
  canSaveHistoricalAlerts: true,
};

// Через переменную окружения EMAIL_SEND_RULE Можно управлять правилом отправки
export const readEmailSendRule = () => {
  const rule = process.env.EMAIL_SEND_RULE as EMailSendRule;
  data.emailSendRule = Object.values(EMailSendRule).includes(rule)
    ? rule
    : EMailSendRule.IF_ALERT_NOT_EXISTS;
};
readEmailSendRule();

export const getEmailSendRule = () => data.emailSendRule;

export const isDeprecatedSendAlertsByEmail = () => data.emailSendRule === EMailSendRule.BLOCK;

const getBool = (v: any): boolean => /^(true|1|yes)$/i.test(String(v));

export const readFlagSaveHistoricalAlerts = () => {
  data.canSaveHistoricalAlerts = !getBool(process.env.NO_SAVE_HISTORY_ALERTS);
};
readFlagSaveHistoricalAlerts();
export const canSaveHistoricalAlerts = () => data.canSaveHistoricalAlerts;
