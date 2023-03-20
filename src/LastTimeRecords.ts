import { DEBUG_LTR, TS_FIELD } from './constants';
import { TDbRecord } from './interfaces';
import { millis2isoZ } from './utils/date-utils';

export class LastTimeRecords {
  private idFields: string[];

  private set: Set<string>;

  private lastTs: number | null;

  constructor (idFields: string[]) {
    this.idFields = idFields;
    this.set = new Set();
    this.lastTs = null;
  }

  flush (ts: number | null = null) {
    this.set = new Set();
    this.lastTs = ts;
  }

  getKey (bufferRecord: any): string {
    return bufferRecord ? this.idFields.map((fieldName) => bufferRecord[fieldName]).join('|') : '';
  }

  private getInfo4debug (bufferRecord: any): TDbRecord {
    if (!bufferRecord?.[TS_FIELD]) {
      return {};
    }
    const ts = bufferRecord[TS_FIELD];
    const info: TDbRecord = { ts, tsISO: millis2isoZ(ts) };
    this.idFields.forEach((fName) => {
      info[fName] = bufferRecord[fName];
    });
    return info;
  }

  /**
   * Populates the cache with entries that have the same latest timestamp.
   * Returns these entries for diagnostics
   */
  fillLastTimeRecords (rb: any[]): TDbRecord[] {
    const currentLastTimeRecords: TDbRecord[] = [];
    if (!rb.length) {
      return currentLastTimeRecords;
    }
    let index = rb.length;
    const { lastTs } = this;
    const ts = rb[index - 1][TS_FIELD];
    if (lastTs !== ts) {
      // There are records in the batch with new timestamps than the one in
      // lastTimeRecords. This means lastTimeRecords must be reset.
      this.flush(ts);
    }
    while (index > -1 && rb[--index]?.[TS_FIELD] === ts) {
      const bufferRecord = rb[index];
      const key = this.getKey(bufferRecord);
      if (key) {
        this.set.add(key);
        // For debug
        if (DEBUG_LTR) {
          currentLastTimeRecords.push(this.getInfo4debug(bufferRecord));
        }
      }
    }
    return currentLastTimeRecords;
  }

  subtractLastTimeRecords (forBuffer: any[]): TDbRecord[] {
    const { lastTs, set } = this;
    const subtractedLastTimeRecords: TDbRecord[] = [];
    if (!set.size || !forBuffer.length) {
      return subtractedLastTimeRecords;
    }
    let index = -1;
    while (forBuffer[++index]?.[TS_FIELD] === lastTs) {
      const key = this.getKey(forBuffer[index]);
      if (key && set.has(key)) {
        const removedRecord = forBuffer.splice(index, 1);
        if (DEBUG_LTR) {
          subtractedLastTimeRecords.push(this.getInfo4debug(removedRecord?.[0]));
        }
        index--;
      }
    }
    return subtractedLastTimeRecords;
  }

  getLtr () {
    const { lastTs } = this;
    const ts = (lastTs && (new Date(lastTs)).toISOString()) || '';
    const hashes = [...this.set];
    hashes.sort();
    return { ts, hashes };
  }
}
