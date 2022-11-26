import { findIndexOfNearestSmaller } from './utils/find-index-of-nearest-smaller';
import { TEventRecord } from './@types/interfaces';
import { TS_FIELD } from './constants';

export class RecordsBuffer {
  public buffer: any[];

  public first: TEventRecord | null;

  public last: TEventRecord | null;

  private firstTs: number;

  public lastTs: number;

  constructor () {
    this.buffer = [];
    this.first = null;
    this.last = null;
    this.firstTs = 0;
    this.lastTs = 0;
    this.setEdges();
  }

  setEdges () {
    const { buffer: rb } = this;
    this.first = rb[0] || null;
    this.last = rb.length ? rb[rb.length - 1] : null;
    this.firstTs = this.first?.[TS_FIELD] || 0;
    this.lastTs = this.last?.[TS_FIELD] || 0;
  }

  add (forBuffer: TEventRecord[]) {
    this.buffer.push(...forBuffer);
    forBuffer.splice(0, forBuffer.length); // GC
    this.setEdges();
  }

  getMsDistance (): number {
    const { firstTs, lastTs } = this;
    if (!this.buffer.length || lastTs < firstTs) {
      return 0;
    }
    return lastTs - firstTs;
  }

  shiftBy (length: number) {
    return this.buffer.splice(0, length);
  }

  unshiftEvents (eventsPacket: any[]) {
    this.buffer.splice(0, 0, ...eventsPacket);
  }

  flush () {
    this.buffer = [];
    this.first = null;
    this.last = null;
    this.firstTs = 0;
    this.lastTs = 0;
  }

  get length () {
    return this.buffer.length;
  }

  // Greatest index of a value less than the specified
  findIndexOfNearestSmaller (virtualTime: number) {
    const { buffer: rb } = this;
    if (!rb.length) {
      return -1;
    }
    return findIndexOfNearestSmaller(rb, virtualTime);
  }
}
