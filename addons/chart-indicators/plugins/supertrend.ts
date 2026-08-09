import type { ChartBar } from '../../../src/chart/extensions';
import type {
  IndicatorCalculator,
  IndicatorOutputData,
  IndicatorOutputUpdate,
  IndicatorParams,
  IndicatorPlugin,
  IndicatorPoint,
} from '../types';

interface SuperTrendState {
  atr: number;
  finalUpper: number;
  finalLower: number;
  value: number;
  up: boolean;
}

const UP = '#e34a4a';
const DOWN = '#3f7fd6';

function round(value: number): number {
  return +value.toFixed(6);
}

function trueRange(bars: readonly ChartBar[], index: number): number {
  const bar = bars[index];
  if (index === 0) return bar.high - bar.low;
  const prevClose = bars[index - 1].close;
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prevClose),
    Math.abs(bar.low - prevClose),
  );
}

function seedAtr(
  bars: readonly ChartBar[],
  period: number,
): number {
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trueRange(bars, i);
  return sum / period;
}

function computeState(
  index: number,
  bars: readonly ChartBar[],
  states: readonly (SuperTrendState | null)[],
  period: number,
  multiplier: number,
): SuperTrendState | null {
  if (index < period - 1) return null;

  const bar = bars[index];
  const hl2 = (bar.high + bar.low) / 2;
  const prev = index > 0 ? states[index - 1] : null;
  const atr = index === period - 1
    ? seedAtr(bars, period)
    : prev
      ? ((prev.atr * (period - 1)) + trueRange(bars, index)) / period
      : trueRange(bars, index);

  const basicUpper = hl2 + multiplier * atr;
  const basicLower = hl2 - multiplier * atr;

  if (!prev) {
    const up = bar.close >= hl2;
    return {
      atr,
      finalUpper: basicUpper,
      finalLower: basicLower,
      value: up ? basicLower : basicUpper,
      up,
    };
  }

  const prevClose = bars[index - 1].close;
  const finalUpper = basicUpper < prev.finalUpper || prevClose > prev.finalUpper
    ? basicUpper
    : prev.finalUpper;
  const finalLower = basicLower > prev.finalLower || prevClose < prev.finalLower
    ? basicLower
    : prev.finalLower;

  const wasUpper = prev.value === prev.finalUpper;
  const value = wasUpper
    ? (bar.close <= finalUpper ? finalUpper : finalLower)
    : (bar.close >= finalLower ? finalLower : finalUpper);

  return {
    atr,
    finalUpper,
    finalLower,
    value,
    up: value === finalLower,
  };
}

function buildStates(
  bars: readonly ChartBar[],
  period: number,
  multiplier: number,
): Array<SuperTrendState | null> {
  const states: Array<SuperTrendState | null> = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    states[i] = computeState(i, bars, states, period, multiplier);
  }
  return states;
}

function trendPoint(time: any, state: SuperTrendState): IndicatorPoint {
  return {
    time,
    value: round(state.value),
    color: state.up ? UP : DOWN,
  };
}

function createCalculator(params: IndicatorParams): IndicatorCalculator {
  const period = Math.max(1, Math.trunc(Number(params.atrPeriod) || 14));
  const multiplier = Math.max(0.01, Number(params.multiplier) || 2);
  let states: Array<SuperTrendState | null> = [];

  const rebuild = (bars: readonly ChartBar[]): IndicatorOutputData => {
    states = buildStates(bars, period, multiplier);
    const trend: IndicatorPoint[] = [];
    for (let i = period - 1; i < bars.length; i++) {
      const state = states[i];
      if (state) trend.push(trendPoint(bars[i].time, state));
    }
    return { trend };
  };

  return {
    reset: rebuild,

    update(bars, change): IndicatorOutputUpdate {
      if (!bars.length) return { trend: null };

      const index = bars.length - 1;
      const expectedLength = change === 'append' ? bars.length - 1 : bars.length;
      if (states.length !== expectedLength) {
        rebuild(bars);
      } else if (change === 'append') {
        states.push(computeState(index, bars, states, period, multiplier));
      } else {
        states[index] = computeState(index, bars, states, period, multiplier);
      }

      const state = states[index];
      return { trend: state ? trendPoint(bars[index].time, state) : null };
    },
  };
}

const plugin: IndicatorPlugin = {
  id: 'supertrend',
  version: 1,
  label: 'SuperTrend',
  parameters: [
    {
      key: 'atrPeriod',
      label: 'ATR 기간',
      type: 'integer',
      default: 14,
      min: 1,
      max: 1000,
      step: 1,
    },
    {
      key: 'multiplier',
      label: '배수',
      type: 'number',
      default: 2,
      min: 0.01,
      max: 100,
      step: 0.1,
    },
  ],
  outputs: [
    {
      id: 'trend',
      label: 'SuperTrend',
      type: 'line',
      pane: 'main',
      options: {
        title: 'ST',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      },
    },
  ],
  create: createCalculator,
};

export default plugin;
