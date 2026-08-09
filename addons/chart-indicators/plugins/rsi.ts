import type { ChartBar } from '../../../src/chart/extensions';
import type {
  IndicatorCalculator,
  IndicatorOutputData,
  IndicatorOutputUpdate,
  IndicatorParams,
  IndicatorPlugin,
  IndicatorPoint,
} from '../types';

interface RsiState {
  avgGain: number;
  avgLoss: number;
  value: number;
}

function round(value: number): number {
  return +value.toFixed(6);
}

function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function seedState(bars: readonly ChartBar[], period: number): RsiState | null {
  if (bars.length <= period) return null;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = bars[i].close - bars[i - 1].close;
    if (delta > 0) gain += delta;
    else loss -= delta;
  }

  const avgGain = gain / period;
  const avgLoss = loss / period;
  return { avgGain, avgLoss, value: rsiValue(avgGain, avgLoss) };
}

function computeState(
  index: number,
  bars: readonly ChartBar[],
  states: readonly (RsiState | null)[],
  period: number,
): RsiState | null {
  if (index < period) return null;
  if (index === period) return seedState(bars, period);

  const prev = states[index - 1];
  if (!prev) return null;

  const delta = bars[index].close - bars[index - 1].close;
  const gain = Math.max(delta, 0);
  const loss = Math.max(-delta, 0);
  const avgGain = ((prev.avgGain * (period - 1)) + gain) / period;
  const avgLoss = ((prev.avgLoss * (period - 1)) + loss) / period;
  return { avgGain, avgLoss, value: rsiValue(avgGain, avgLoss) };
}

function buildStates(bars: readonly ChartBar[], period: number): Array<RsiState | null> {
  const states: Array<RsiState | null> = new Array(bars.length).fill(null);
  for (let i = period; i < bars.length; i++) {
    states[i] = computeState(i, bars, states, period);
  }
  return states;
}

function constantRange(
  bars: readonly ChartBar[],
  value: number,
): IndicatorPoint[] {
  if (!bars.length) return [];
  if (bars.length === 1) return [{ time: bars[0].time, value }];
  return [
    { time: bars[0].time, value },
    { time: bars[bars.length - 1].time, value },
  ];
}

function createCalculator(params: IndicatorParams): IndicatorCalculator {
  const period = Math.max(2, Math.trunc(Number(params.period) || 14));
  const upper = Number(params.upper) || 70;
  const lower = Number(params.lower) || 30;
  let states: Array<RsiState | null> = [];

  const rebuild = (bars: readonly ChartBar[]): IndicatorOutputData => {
    states = buildStates(bars, period);
    const rsi: IndicatorPoint[] = [];
    for (let i = period; i < bars.length; i++) {
      const state = states[i];
      if (state) rsi.push({ time: bars[i].time, value: round(state.value) });
    }
    return {
      rsi,
      upper: constantRange(bars, upper),
      lower: constantRange(bars, lower),
    };
  };

  return {
    reset: rebuild,

    update(bars, change): IndicatorOutputUpdate {
      if (!bars.length) return { rsi: null, upper: null, lower: null };

      const lastIndex = bars.length - 1;
      const expectedLength = change === 'append' ? bars.length - 1 : bars.length;
      if (states.length !== expectedLength) {
        rebuild(bars);
      } else if (change === 'append') {
        states.push(computeState(lastIndex, bars, states, period));
      } else {
        states[lastIndex] = computeState(lastIndex, bars, states, period);
      }

      const state = states[lastIndex];
      return {
        rsi: state ? { time: bars[lastIndex].time, value: round(state.value) } : null,
        upper: { time: bars[lastIndex].time, value: upper },
        lower: { time: bars[lastIndex].time, value: lower },
      };
    },
  };
}

const plugin: IndicatorPlugin = {
  id: 'rsi',
  version: 1,
  label: '상대강도지수 (RSI)',
  parameters: [
    { key: 'period', label: '기간', type: 'integer', default: 14, min: 2, max: 500, step: 1 },
    { key: 'upper', label: '과매수', type: 'number', default: 70, min: 1, max: 100, step: 1 },
    { key: 'lower', label: '과매도', type: 'number', default: 30, min: 0, max: 99, step: 1 },
  ],
  outputs: [
    {
      id: 'rsi',
      label: 'RSI',
      type: 'line',
      pane: 'own',
      options: {
        title: 'RSI',
        color: '#e5c07b',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'upper',
      label: 'Upper',
      type: 'line',
      pane: 'own',
      options: {
        color: 'rgba(224,108,117,.55)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'lower',
      label: 'Lower',
      type: 'line',
      pane: 'own',
      options: {
        color: 'rgba(86,182,194,.55)',
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
