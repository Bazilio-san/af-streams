export class LastTimeRecords {
  private tsField: string;

  private idFields: string[];

  private set: Set<any>;

  private lastTs: number | null;

  constructor (tsField: string, idFields: string[]) {
    this.tsField = tsField;
    this.idFields = idFields;
    this.set = new Set();
    this.lastTs = null;
  }

  flush (ts: number | null = null) {
    this.set = new Set();
    this.lastTs = ts;
  }

  getKey (bufferRecord: any) {
    if (bufferRecord) {
      return this.idFields.map((fieldName) => bufferRecord[fieldName]).join('|');
    }
  }

  fillLastTimeRecords (rb: any[]) {
    if (!rb.length) {
      return;
    }
    let index = rb.length;
    const { tsField, lastTs } = this;
    const ts = rb[index - 1][tsField];
    if (lastTs !== ts) {
      // There are records in the batch with new timestamps than the one in
      // lastTimeRecords. This means lastTimeRecords must be reset.
      this.flush(ts);
    }
    while (index > -1 && rb[--index]?.[tsField] === ts) {
      this.set.add(this.getKey(rb[index]));
    }
  }

  subtractLastTimeRecords (forBuffer: any[]) {
    const { tsField, lastTs, set } = this;
    if (!set.size || !forBuffer.length) {
      return;
    }
    let index = -1;
    while (forBuffer[++index]?.[tsField] === lastTs) {
      if (set.has(this.getKey(forBuffer[index]))) {
        forBuffer.splice(index, 1);
        index--;
      }
    }
  }

  getLtr () {
    const { lastTs } = this;
    const ts = (lastTs && (new Date(lastTs)).toISOString()) || '';
    const hashes = [...this.set];
    hashes.sort();
    return { ts, hashes };
  }
}
