import { findSmallestIndex } from './utils/utils';
import { TEventRecord } from './interfaces';

export class RecordsBuffer {
  private tsField: string;

  public buffer: any[];

  public first: TEventRecord | null;

  public last: TEventRecord | null;

  private firstTs: number;

  public lastTs: number;

  constructor (tsField: string) {
    this.tsField = tsField;
    this.buffer = [];
    this.first = null;
    this.last = null;
    this.firstTs = 0;
    this.lastTs = 0;
    this.setEdges();
  }

  setEdges () {
    const { buffer: rb, tsField } = this;
    this.first = rb[0] || null;
    this.last = rb.length ? rb[rb.length - 1] : null;
    this.firstTs = this.first?.[tsField] || 0;
    this.lastTs = this.last?.[tsField] || 0;
  }

  add (forBuffer: TEventRecord[]) {
    this.buffer.push(...forBuffer);
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

  getBuffer () {
    return this.buffer;
  }

  get length () {
    return this.buffer.length;
  }

  // Greatest index of a value less than the specified
  findSmallestIndex (virtualTime: number) {
    const { buffer: rb, tsField } = this;
    if (!rb.length) {
      return -1;
    }
    return findSmallestIndex(rb, virtualTime, tsField);
  }
}
