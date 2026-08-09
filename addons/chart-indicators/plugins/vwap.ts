import type { ChartBar } from '../../../src/chart/extensions';
import type {
  IndicatorCalculator,
  IndicatorOutputData,
  IndicatorOutputUpdate,
  IndicatorParams,
  IndicatorPlugin,
  IndicatorPoint,
} from '../types';

interface VwapState {
  tradingDate: string;
  priceVolume: number;
  volume: number;
  priceSquaredVolume: number;
}

interface VwapValues {
  state: VwapState;
  value: number | null;
  upper1: number | null;
  lower1: number | null;
  upper2: number | null;
  lower2: number | null;
}

function numberParam(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function boolParam(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function tradingDateOf(bar: ChartBar): string {
  const explicit = String(bar.tradingDate ?? '').trim();
  if (explicit) return explicit;

  if (typeof bar.time === 'number' && Number.isFinite(bar.time)) {
    return new Date(Math.trunc(bar.time) * 1000).toISOString().slice(0, 10);
  }

  const text = String(bar.time ?? '').trim();
  if (text.length >= 10) return text.slice(0, 10);
  throw new Error('VWAP requires a trading-date boundary.');
}

function point(time: any, value: number | null): IndicatorPoint | null {
  return value === null ? null : { time, value };
}

function step(
  previous: VwapState | null,
  bar: ChartBar,
  stdDev1: number,
  stdDev2: number,
): VwapValues {
  const tradingDate = tradingDateOf(bar);
  const sameSession = previous?.tradingDate === tradingDate;
  const state: VwapState = sameSession && previous
    ? { ...previous }
    : {
        tradingDate,
        priceVolume: 0,
        volume: 0,
        priceSquaredVolume: 0,
      };

  const typicalPrice = (bar.high + bar.low + bar.close) / 3;
  const volume = bar.volume;
  state.priceVolume += typicalPrice * volume;
  state.volume += volume;
  state.priceSquaredVolume += typicalPrice * typicalPrice * volume;

  if (state.volume <= 0) {
    return {
      state,
      value: null,
      upper1: null,
      lower1: null,
      upper2: null,
      lower2: null,
    };
  }

  const vwap = state.priceVolume / state.volume;
  const variance = Math.max(
    0,
    state.priceSquaredVolume / state.volume - vwap * vwap,
  );
  const deviation = Math.sqrt(variance);

  return {
    state,
    value: Math.fround(vwap),
    upper1: Math.fround(vwap + stdDev1 * deviation),
    lower1: Math.fround(vwap - stdDev1 * deviation),
    upper2: Math.fround(vwap + stdDev2 * deviation),
    lower2: Math.fround(vwap - stdDev2 * deviation),
  };
}

function createCalculator(params: IndicatorParams): IndicatorCalculator {
  const stdDev1 = numberParam(params.stdDev1, 1, 0, 100);
  const stdDev2 = numberParam(params.stdDev2, 2, 0, 100);
  const visible = {
    value: boolParam(params.showValue, true),
    upper1: boolParam(params.showUpper1, true),
    lower1: boolParam(params.showLower1, true),
    upper2: boolParam(params.showUpper2, true),
    lower2: boolParam(params.showLower2, true),
  };
  let states: VwapState[] = [];

  const rebuild = (bars: readonly ChartBar[]): IndicatorOutputData => {
    states = [];
    const out: IndicatorOutputData = {
      value: [],
      upper1: [],
      lower1: [],
      upper2: [],
      lower2: [],
    };

    let previous: VwapState | null = null;
    for (const bar of bars) {
      const current = step(previous, bar, stdDev1, stdDev2);
      states.push(current.state);
      previous = current.state;

      for (const key of ['value', 'upper1', 'lower1', 'upper2', 'lower2'] as const) {
        if (!visible[key]) continue;
        const p = point(bar.time, current[key]);
        if (p) out[key].push(p);
      }
    }
    return out;
  };

  return {
    reset: rebuild,

    update(bars, change): IndicatorOutputUpdate {
      if (!bars.length) {
        states = [];
        return { value: null, upper1: null, lower1: null, upper2: null, lower2: null };
      }

      const index = bars.length - 1;
      const expectedLength = change === 'append' ? bars.length - 1 : bars.length;
      if (states.length !== expectedLength) {
        const data = rebuild(bars);
        return Object.fromEntries(
          ['value', 'upper1', 'lower1', 'upper2', 'lower2'].map(key => {
            const rows = data[key] ?? [];
            return [key, rows.length ? rows[rows.length - 1] : null];
          }),
        ) as IndicatorOutputUpdate;
      }

      const previous = index > 0 ? states[index - 1] : null;
      const current = step(previous, bars[index], stdDev1, stdDev2);
      if (change === 'append') states.push(current.state);
      else states[index] = current.state;

      return {
        value: visible.value ? point(bars[index].time, current.value) : null,
        upper1: visible.upper1 ? point(bars[index].time, current.upper1) : null,
        lower1: visible.lower1 ? point(bars[index].time, current.lower1) : null,
        upper2: visible.upper2 ? point(bars[index].time, current.upper2) : null,
        lower2: visible.lower2 ? point(bars[index].time, current.lower2) : null,
      };
    },
  };
}

const plugin: IndicatorPlugin = {
  id: 'vwap',
  version: 1,
  label: 'VWAP',
  parameters: [
    { key: 'stdDev1', label: '표준편차 1', type: 'number', default: 1, min: 0, max: 100, step: 0.1 },
    { key: 'stdDev2', label: '표준편차 2', type: 'number', default: 2, min: 0, max: 100, step: 0.1 },
    { key: 'showValue', label: 'VWAP 표시', type: 'boolean', default: true },
    { key: 'showUpper1', label: 'Upper1 표시', type: 'boolean', default: true },
    { key: 'showLower1', label: 'Lower1 표시', type: 'boolean', default: true },
    { key: 'showUpper2', label: 'Upper2 표시', type: 'boolean', default: true },
    { key: 'showLower2', label: 'Lower2 표시', type: 'boolean', default: true },
  ],
  outputs: [
    {
      id: 'value',
      label: 'VWAP',
      type: 'line',
      pane: 'main',
      options: {
        title: 'VWAP',
        color: '#00E5FF',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'upper1',
      label: 'Upper1',
      type: 'line',
      pane: 'main',
      options: {
        title: 'VWAP +1σ',
        color: 'rgba(255,235,59,.32)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'lower1',
      label: 'Lower1',
      type: 'line',
      pane: 'main',
      options: {
        title: 'VWAP -1σ',
        color: 'rgba(255,235,59,.32)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'upper2',
      label: 'Upper2',
      type: 'line',
      pane: 'main',
      options: {
        title: 'VWAP +2σ',
        color: 'rgba(255,112,67,.20)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'lower2',
      label: 'Lower2',
      type: 'line',
      pane: 'main',
      options: {
        title: 'VWAP -2σ',
        color: 'rgba(255,112,67,.20)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
  ],
  create: createCalculator,
};

export default plugin;
