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
const getBool = (v: any): boolean => /^(true|1|yes)$/i.test(String(v));

// Через переменную окружения EMAIL_SEND_RULE Можно управлять правилом отправки
export const reloadStreamsEnv = () => {
  const rule = process.env.EMAIL_SEND_RULE as EMailSendRule;
  data.emailSendRule = Object.values(EMailSendRule).includes(rule)
    ? rule
    : EMailSendRule.IF_ALERT_NOT_EXISTS;
  data.canSaveHistoricalAlerts = !getBool(process.env.NO_SAVE_HISTORY_ALERTS);
};
reloadStreamsEnv();

export const getEmailSendRule = () => data.emailSendRule;
export const isDeprecatedSendAlertsByEmail = () => data.emailSendRule === EMailSendRule.BLOCK;
export const canSaveHistoricalAlerts = () => data.canSaveHistoricalAlerts;
