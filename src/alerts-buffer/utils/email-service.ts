import * as nodemailer from 'nodemailer';
import SMTPConnection from 'nodemailer/lib/smtp-connection';
import { IAlertEmailSettings } from '../i-alert';

export interface ISendAlertArgs {
  to: string | string[],
  subject: string,
  text: string,
  html?: string,
  callback?: (_err?: Error | null, _info?: any) => void
}

export const getSendMail = (emailSettings: IAlertEmailSettings, logger: { error: Function }): ((_options: ISendAlertArgs) => void) => {
  const { from, smtp: { host, port, auth: { user, pass } } } = emailSettings;

  let reason = '';
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.(finam)\.ru/i;

  if (!user) {
    reason = 'Sender AD login not specified';
  } else if (!pass) {
    reason = 'Sender AD password not set';
  } else if (!host) {
    reason = 'SMTP-host not set';
  } else if (!port) {
    reason = 'SMTP-port not set';
  } else if (!from) {
    reason = 'Sender address not set';
  } else if (!re.test(from)) {
    reason = `The sender's address (${from}) is incorrect or does not belong to the finam.ru domain`;
  }

  const canSendEmail = !reason;
  if (reason) {
    logger.error(`Can not send Email. Reason: ${reason}`);
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    auth: { user, pass },
    secure: false,
    tls: {
      // do not fail on invalid certs
      rejectUnauthorized: false,
    },
  } as SMTPConnection.Options);

  return (options: ISendAlertArgs) => {
    if (!canSendEmail) {
      options.callback?.(new Error(`Can not send Email. Reason: ${reason}`));
      return;
    }
    const { subject, text, html, callback = () => undefined } = options;
    let { to } = options;
    to = Array.isArray(to) ? to : [to];
    const message = { from, to, subject, text, html };
    transport.sendMail(message, callback);
  };
};
