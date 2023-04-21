import { getInstanceKey } from 'af-tools-ts';

export const getStreamKey = (stringId: string) => getInstanceKey() + stringId;
export const capitalizeFirstLetter = (s: string) => s[0].toUpperCase() + s.substring(1);
