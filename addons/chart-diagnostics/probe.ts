export type LiveBarChange = 'append' | 'replace';

export interface DiagnosticSeriesSnapshot {
  id: string;
  label: string;
  setData: number;
  update: number;
}

export interface DiagnosticSnapshot {
  measuring: boolean;
  startedAt: number;
  barsReset: number;
  barAppend: number;
  barReplace: number;
  setData: number;
  update: number;
  patchedSeries: number;
  patchFailures: number;
  series: DiagnosticSeriesSnapshot[];
}

interface SeriesCounter {
  id: string;
  label: string;
  setData: number;
  update: number;
}

interface SeriesPatch {
  series: any;
  originalSetData?: (...args: any[]) => any;
  originalUpdate?: (...args: any[]) => any;
  wrappedSetData?: (...args: any[]) => any;
  wrappedUpdate?: (...args: any[]) => any;
}

export class ChartRuntimeProbe {
  private measuring = false;
  private startedAt = 0;
  private barsReset = 0;
  private barAppend = 0;
  private barReplace = 0;
  private setDataCalls = 0;
  private updateCalls = 0;
  private patchFailures = 0;
  private seriesSeq = 0;

  private readonly counters = new Map<string, SeriesCounter>();
  private readonly patched = new WeakMap<object, SeriesCounter>();
  private readonly patches: SeriesPatch[] = [];

  private originalAddSeries?: (...args: any[]) => any;
  private wrappedAddSeries?: (...args: any[]) => any;

  constructor(private readonly chart: any) {}

  install(): void {
    this.scanSeries();
    if (typeof this.chart?.addSeries !== 'function' || this.wrappedAddSeries) return;

    this.originalAddSeries = this.chart.addSeries;
    this.wrappedAddSeries = (...args: any[]) => {
      const series = this.originalAddSeries!.apply(this.chart, args);
      this.wrapSeries(series);
      return series;
    };

    try {
      this.chart.addSeries = this.wrappedAddSeries;
    } catch {
      this.patchFailures++;
      this.wrappedAddSeries = undefined;
    }
  }

  dispose(): void {
    if (
      this.originalAddSeries
      && this.wrappedAddSeries
      && this.chart?.addSeries === this.wrappedAddSeries
    ) {
      try {
        this.chart.addSeries = this.originalAddSeries;
      } catch {
        // 진단 제거 실패가 차트 dispose를 막지 않는다.
      }
    }

    for (const patch of this.patches.splice(0)) {
      this.restorePatch(patch);
    }
  }

  start(): void {
    this.measuring = true;
    this.startedAt = Date.now();
    this.barsReset = 0;
    this.barAppend = 0;
    this.barReplace = 0;
    this.setDataCalls = 0;
    this.updateCalls = 0;
    for (const counter of this.counters.values()) {
      counter.setData = 0;
      counter.update = 0;
    }
  }

  stop(): void {
    this.measuring = false;
  }

  recordBarsReset(): void {
    this.scanSeries();
    if (this.measuring) this.barsReset++;
  }

  recordBarChange(change: LiveBarChange): void {
    this.scanSeries();
    if (!this.measuring) return;
    if (change === 'append') this.barAppend++;
    else this.barReplace++;
  }

  scanSeries(): void {
    const panes = typeof this.chart?.panes === 'function' ? this.chart.panes() : [];
    for (const pane of panes ?? []) {
      let rows: any[] = [];
      try {
        rows = typeof pane?.getSeries === 'function' ? pane.getSeries() : [];
      } catch {
        continue;
      }
      for (const series of rows ?? []) this.wrapSeries(series);
    }
  }

  snapshot(): DiagnosticSnapshot {
    return {
      measuring: this.measuring,
      startedAt: this.startedAt,
      barsReset: this.barsReset,
      barAppend: this.barAppend,
      barReplace: this.barReplace,
      setData: this.setDataCalls,
      update: this.updateCalls,
      patchedSeries: this.counters.size,
      patchFailures: this.patchFailures,
      series: Array.from(this.counters.values())
        .map(row => ({ ...row }))
        .sort((a, b) => b.update - a.update || b.setData - a.setData || a.label.localeCompare(b.label)),
    };
  }

  private wrapSeries(series: any): void {
    if (!series || (typeof series !== 'object' && typeof series !== 'function')) return;
    if (this.patched.has(series)) return;

    const counter: SeriesCounter = {
      id: `series-${++this.seriesSeq}`,
      label: this.seriesLabel(series, this.seriesSeq),
      setData: 0,
      update: 0,
    };
    this.patched.set(series, counter);
    this.counters.set(counter.id, counter);

    const patch: SeriesPatch = { series };

    if (typeof series.setData === 'function') {
      patch.originalSetData = series.setData;
      patch.wrappedSetData = (...args: any[]) => {
        const result = patch.originalSetData!.apply(series, args);
        if (this.measuring) {
          this.setDataCalls++;
          counter.setData++;
        }
        return result;
      };
    }

    if (typeof series.update === 'function') {
      patch.originalUpdate = series.update;
      patch.wrappedUpdate = (...args: any[]) => {
        const result = patch.originalUpdate!.apply(series, args);
        if (this.measuring) {
          this.updateCalls++;
          counter.update++;
        }
        return result;
      };
    }

    try {
      if (patch.wrappedSetData) series.setData = patch.wrappedSetData;
      if (patch.wrappedUpdate) series.update = patch.wrappedUpdate;
      this.patches.push(patch);
    } catch {
      this.patchFailures++;
      this.restorePatch(patch);
      this.counters.delete(counter.id);
    }
  }

  private restorePatch(patch: SeriesPatch): void {
    try {
      if (patch.wrappedSetData && patch.series.setData === patch.wrappedSetData) {
        patch.series.setData = patch.originalSetData;
      }
      if (patch.wrappedUpdate && patch.series.update === patch.wrappedUpdate) {
        patch.series.update = patch.originalUpdate;
      }
    } catch {
      // 이미 제거됐거나 write-protected인 series는 무시한다.
    }
  }

  private seriesLabel(series: any, seq: number): string {
    let paneIndex = '?';
    let type = 'Series';
    let title = '';

    try {
      const pane = series.getPane?.();
      const index = pane?.paneIndex?.();
      if (Number.isFinite(index)) paneIndex = String(index);
    } catch {
      // optional metadata
    }

    try {
      type = String(series.seriesType?.() ?? type);
    } catch {
      // optional metadata
    }

    try {
      title = String(series.options?.()?.title ?? '').trim();
    } catch {
      // optional metadata
    }

    return `P${paneIndex} ${title || type} #${seq}`;
  }
}
