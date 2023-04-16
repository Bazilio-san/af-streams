import { FormatOptions, prettyPrintJson } from 'pretty-print-json';
import * as os from 'os';
import { millisTo, removeHTML } from 'af-tools-ts';
import { TAlert, TAlertEmailDetails } from '../i-alert';

export const htmlTemplate = `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><%title%></title>
<style  type="text/css">
.json-container {
  font-family: monospace, consolas, menlo;
  font-size: 13px;
}
ol.json-lines {
  white-space: normal;
  padding-inline-start: 0.5em;
  margin: 0;
}
ol.json-lines >li {
  white-space: pre;
  text-indent: 0.7em;
  line-height: 1.32em;
  padding: 0;
}
ol.json-lines >li::marker {
  font-family: system-ui, sans-serif;
  font-weight: normal;
}
.json-pretty {
  padding-left: 30px;
  padding-right: 30px;
}
.json-string {
  color: #000;
}
.json-key {
  color: #000080;
  font-weight: 600;
}
.json-boolean {
  color: #007300;
}
.json-number {
  color: #00f;
}
.email-pre-header {
  margin-bottom: 20px;
}
.email-header {
  font-family: monospace, consolas, menlo;
  font-size: 15px;
  font-weight: bold;
  background-color: #e5e5e5;
  padding: 5px;
}
.email-footer {
  font-family: monospace, consolas, menlo;
  font-size: 13px;
}
</style>
</head>
<body>
  <%body%>
</body>
</html>
`;

export interface TFillHtmlTemplateArgs {
  title?: string,
  body?: string
}

export const fillHtmlTemplate = (args: TFillHtmlTemplateArgs): string => {
  let text = htmlTemplate;
  ['title', 'body'].forEach((n) => {
    text = text.replace(`<%${n}%>`, args[n as keyof TFillHtmlTemplateArgs] || '');
  });
  return text;
};

export const jsonToHtml = (json: any): string => {
  const prettyPrintJsonOptions: FormatOptions = { linkUrls: true, indent: 2 };
  return `<pre class="json-container">${prettyPrintJson.toHtml(json, prettyPrintJsonOptions)}\n</pre>`;
};

const rSpace = (str: string, strLength: number) => {
  str = removeHTML(String(str || ''));
  if (str.length < strLength) {
    return ' '.repeat(Math.min(Math.max(0, strLength - str.length), 10000));
  }
  return '';
};

export const alertEmailDetails = (options: { detailsArray: TAlertEmailDetails, indent?: string, prefix?: string }): string => {
  const { detailsArray, indent = '', prefix = '' } = options;
  const padLen = Math.max(...detailsArray.map(([label]) => removeHTML(label).length)) + 2;
  return detailsArray.map(([label, text]) => indent + prefix + label + rSpace(label, padLen) + text).join('\n');
};

export const alertEmailHeader = (args: { alert: TAlert, wrapPre?: boolean, indent?: string, prefix?: string }): string => {
  const { alert, wrapPre = false, indent = '', prefix = '# ' } = args;
  const { eventName } = alert;
  const detailsArray: TAlertEmailDetails = [[millisTo.human.utc.z(alert.ts), `Event: [${eventName}]`]];
  let header = alertEmailDetails({ detailsArray, indent, prefix });
  header = `<span class="email-header">${header}</span>`;
  return wrapPre ? `<pre class="email-pre-header">${header}</pre>` : header;
};

const THIS_HOST_NAME = os.hostname();
const COMMON_LINK_PART = `/alerts?clue=1,100,ts,1$f:ts=null;createdAt=null;tsFrom=null;tsTo=null`;
const getTypedAlertsLink = (linkBase: string, alertTypeId: number) => `${linkBase}${COMMON_LINK_PART};alertTypeId=${alertTypeId}`;
const getCertainAlertsLink = (linkBase: string, alertGUID: string) => `${linkBase}${COMMON_LINK_PART};guid=${alertGUID}`;

export const alertEmailFooter = (args: {
  alert: TAlert,
  wrapPre?: boolean,
  indent?: string,
  prefix?: string,
  linkBase?: string,
}): string => {
  const { alert, wrapPre = false, indent = '', prefix = '# ', linkBase } = args;
  const { hashTags = [], guid, alertTypeId = 0 } = alert;

  const detailsArray: TAlertEmailDetails = [];
  if (linkBase) {
    detailsArray.push(['Signal URL', getCertainAlertsLink(linkBase, guid)]);
  }
  detailsArray.push(['Service host', THIS_HOST_NAME], ...hashTags.map((tag) => [tag, '']) as TAlertEmailDetails);
  if (linkBase) {
    detailsArray.push([`Alerts of type`, getTypedAlertsLink(linkBase, alertTypeId)]);
  }

  let footer = alertEmailDetails({ detailsArray, indent, prefix });
  footer = `<span class="email-footer">${footer}</span>`;
  return wrapPre ? `<pre>${footer}</pre>` : footer;
};
