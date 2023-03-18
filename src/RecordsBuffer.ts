import { findIndexOfNearestSmaller } from './utils/find-index-of-nearest-smaller';
import { TEventRecord } from './interfaces';
import { TS_FIELD } from './constants';

export class RecordsBuffer {
  public buffer: any[] = [];

  get length () {
    return this.buffer.length;
  }

  get first (): TEventRecord | null {
    return this.buffer[0] || null;
  }

  get last (): TEventRecord | null {
    const { buffer: rb } = this;
    return rb.length ? rb[rb.length - 1] : null;
  }

  get firstTs (): number {
    return this.first?.[TS_FIELD] || 0;
  }

  get lastTs (): number {
    return this.last?.[TS_FIELD] || 0;
  }

  getMsDistance (): number {
    return this.buffer.length ? Math.max(0, this.lastTs - this.firstTs) : 0;
  }

  add (forBuffer: TEventRecord[]) {
    this.buffer.push(...forBuffer);
  }

  shiftBy (length: number) {
    return this.buffer.splice(0, length);
  }

  unshiftEvents (eventsPacket: any[]) {
    this.buffer.splice(0, 0, ...eventsPacket);
  }

  flush () {
    this.buffer = [];
  }

  // Greatest index of a value less than the specified
  findIndexOfNearestSmaller (virtualTime: number) {
    return this.length ? findIndexOfNearestSmaller(this.buffer, virtualTime) : -1;
  }
}
