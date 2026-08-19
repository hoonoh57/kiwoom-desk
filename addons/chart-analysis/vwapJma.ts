import type { ChartBar, ChartBarChange } from '../../src/chart/extensions';

export interface AnalysisPoint {
  time: any;
  value: number;
  color?: string;
}

export type AnalysisOutputData = Record<string, AnalysisPoint[]>;
export type AnalysisOutputUpdate = Record<string, AnalysisPoint | null>;

export interface AnalysisCalculator {
  reset(bars: readonly ChartBar[]): AnalysisOutputData;
  update(bars: readonly ChartBar[], change: ChartBarChange): AnalysisOutputUpdate;
}

interface JmaState {
  e0: number;
  e1: number;
  e2: number;
  lastJma: number;
  warmSum: number;
  direction: number;
  count: number;
  initialized: boolean;
}

const JMA_UP = '#AB47BC';
const JMA_DOWN = '#00C853';

function cloneJmaState(state: JmaState | null): JmaState {
  return state
    ? { ...state }
    : {
        e0: 0,
        e1: 0,
        e2: 0,
        lastJma: 0,
        warmSum: 0,
        direction: 0,
        count: 0,
        initialized: false,
      };
}

function roundToEven(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  let rounded: number;
  if (Math.abs(fraction - 0.5) <= epsilon) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else {
    rounded = Math.round(scaled);
  }
  return rounded / factor;
}

function integerParam(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  const integer = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, integer));
}

export function createJmaAnalysis(params: { period?: unknown; phase?: unknown; power?: unknown }): AnalysisCalculator {
  const period = integerParam(params.period, 14, 1, 10_000);
  const phase = integerParam(params.phase, 50, -100, 100);
  const power = integerParam(params.power, 2, 1, 10_000);
  let states: JmaState[] = [];

  const step = (previousState: JmaState | null, bar: ChartBar) => {
    const state = cloneJmaState(previousState);
    const source = bar.close;
    if (!state.initialized) {
      state.e0 = source;
      state.e1 = 0;
      state.e2 = 0;
      state.lastJma = source;
      state.initialized = true;
    }
    const beta = 0.45 * (period - 1) / (0.45 * (period - 1) + 2);
    const alpha = beta ** power;
    state.e0 = (1 - alpha) * source + alpha * state.e0;
    state.e1 = (source - state.e0) * (1 - beta) + beta * state.e1;
    state.e2 = (
      state.e0 + (phase / 100 + 1.5) * state.e1 - state.lastJma
    ) * ((1 - alpha) ** 2) + (alpha ** 2) * state.e2;
    state.count++;
    state.warmSum += source;
    const current = state.count <= period
      ? roundToEven(state.warmSum / state.count, 4)
      : roundToEven(state.e2 + state.lastJma, 4);
    const previous = state.lastJma;
    if (current > previous) state.direction = 1;
    else if (current < previous) state.direction = -1;
    else if (state.direction === 0) state.direction = 1;
    state.lastJma = current;
    return {
      state,
      point: {
        time: bar.time,
        value: current,
        color: state.direction >= 0 ? JMA_UP : JMA_DOWN,
      } satisfies AnalysisPoint,
    };
  };

  const rebuild = (bars: readonly ChartBar[]): AnalysisOutputData => {
    states = [];
    const value: AnalysisPoint[] = [];
    let previous: JmaState | null = null;
    for (const bar of bars) {
      const result = step(previous, bar);
      states.push(result.state);
      value.push(result.point);
      previous = result.state;
    }
    return { value };
  };

  return {
    reset: rebuild,
    update(bars, change) {
      if (!bars.length) return { value: null };
      const index = bars.length - 1;
      const expectedLength = change === 'append' ? bars.length - 1 : bars.length;
      if (states.length !== expectedLength) {
        const data = rebuild(bars);
        return { value: data.value[data.value.length - 1] ?? null };
      }
      const previous = index > 0 ? states[index - 1] : null;
      const result = step(previous, bars[index]);
      if (change === 'append') states.push(result.state);
      else states[index] = result.state;
      return { value: result.point };
    },
  };
}

interface VwapState {
  tradingDate: string;
  priceVolume: number;
  volume: number;
  priceSquaredVolume: number;
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

function analysisPoint(time: any, value: number | null): AnalysisPoint | null {
  return value === null ? null : { time, value };
}

export function createVwapAnalysis(params: {
  stdDev1?: unknown;
  stdDev2?: unknown;
  showValue?: unknown;
  showUpper1?: unknown;
  showLower1?: unknown;
  showUpper2?: unknown;
  showLower2?: unknown;
}): AnalysisCalculator {
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

  const step = (previous: VwapState | null, bar: ChartBar) => {
    const tradingDate = tradingDateOf(bar);
    const sameSession = previous?.tradingDate === tradingDate;
    const state: VwapState = sameSession && previous
      ? { ...previous }
      : { tradingDate, priceVolume: 0, volume: 0, priceSquaredVolume: 0 };
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    const volume = bar.volume;
    state.priceVolume += typicalPrice * volume;
    state.volume += volume;
    state.priceSquaredVolume += typicalPrice * typicalPrice * volume;
    if (state.volume <= 0) {
      return { state, value: null, upper1: null, lower1: null, upper2: null, lower2: null };
    }
    const vwap = state.priceVolume / state.volume;
    const variance = Math.max(0, state.priceSquaredVolume / state.volume - vwap * vwap);
    const deviation = Math.sqrt(variance);
    return {
      state,
      value: Math.fround(vwap),
      upper1: Math.fround(vwap + stdDev1 * deviation),
      lower1: Math.fround(vwap - stdDev1 * deviation),
      upper2: Math.fround(vwap + stdDev2 * deviation),
      lower2: Math.fround(vwap - stdDev2 * deviation),
    };
  };

  const rebuild = (bars: readonly ChartBar[]): AnalysisOutputData => {
    states = [];
    const out: AnalysisOutputData = { value: [], upper1: [], lower1: [], upper2: [], lower2: [] };
    let previous: VwapState | null = null;
    for (const bar of bars) {
      const current = step(previous, bar);
      states.push(current.state);
      previous = current.state;
      for (const key of ['value', 'upper1', 'lower1', 'upper2', 'lower2'] as const) {
        if (!visible[key]) continue;
        const p = analysisPoint(bar.time, current[key]);
        if (p) out[key].push(p);
      }
    }
    return out;
  };

  return {
    reset: rebuild,
    update(bars, change) {
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
        ) as AnalysisOutputUpdate;
      }
      const previous = index > 0 ? states[index - 1] : null;
      const current = step(previous, bars[index]);
      if (change === 'append') states.push(current.state);
      else states[index] = current.state;
      return {
        value: visible.value ? analysisPoint(bars[index].time, current.value) : null,
        upper1: visible.upper1 ? analysisPoint(bars[index].time, current.upper1) : null,
        lower1: visible.lower1 ? analysisPoint(bars[index].time, current.lower1) : null,
        upper2: visible.upper2 ? analysisPoint(bars[index].time, current.upper2) : null,
        lower2: visible.lower2 ? analysisPoint(bars[index].time, current.lower2) : null,
      };
    },
  };
}
