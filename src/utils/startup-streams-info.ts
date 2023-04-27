import { magenta, lBlue, cyan, rs, green, underline, underlineOff } from 'af-color';
import { IStreamConfig } from '../interfaces';

export const startUpStreamsInfo = (cfg: any, streamConfigs: IStreamConfig[]) => {
  const padding = Math.max(...streamConfigs.map((v) => v.streamId.length)) + 2;
  const pad = (v: any) => String(v) + ' '.repeat(padding - String(v).length);

  const info = streamConfigs.map((streamCfg) => {
    const { src, streamId } = streamCfg;
    const d = cfg.database[src.dbConfig.id || ''];
    return `  ${lBlue}${pad(streamId)}${
      cyan}${d.user}${rs}@${magenta}[${d.server}:${d.port}].[${lBlue}${underline}${d.database}${underlineOff}${magenta}]${
      rs}.${cyan}[${src.schema}].[${src.table}]`;
  }).join('\n');
  return `${green}Streams:\n${info}`;
};
