// eslint-disable-next-line no-shadow
export enum EMailSendRule {
  IF_ALERT_NOT_EXISTS = 'IF_ALERT_NOT_EXISTS',
  BLOCK = 'BLOCK',
  FORCE = 'FORCE'
}

// Через переменную окружения EMAIL_SEND_RULE Можно управлять правилом отправки
let emailSendRule = process.env.EMAIL_SEND_RULE;
if (!Object.values(EMailSendRule).includes(emailSendRule as EMailSendRule)) {
  emailSendRule = EMailSendRule.IF_ALERT_NOT_EXISTS;
}

export const EMAIL_SEND_RULE = emailSendRule;

// Эта константа позволяет на ранней стадии отсечь отправку сигнала в буфер и сэкономить память
export const DEPRECATED_SEND_ALERTS_BY_EMAIL = EMAIL_SEND_RULE === EMailSendRule.BLOCK;
