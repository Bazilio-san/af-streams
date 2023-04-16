import { getInstanceKey } from 'af-tools-ts';

export const getStreamKey = (stringId: string) => getInstanceKey() + stringId;
