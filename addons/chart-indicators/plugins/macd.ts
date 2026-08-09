import type { ChartBar } from '../../../src/chart/extensions';
import type {
  IndicatorCalculator,
  IndicatorOutputData,
  IndicatorOutputUpdate,
  IndicatorParams,
  IndicatorPlugin,
  IndicatorPoint,
} from '../types';

interface MacdState {
  fast: number;
  slow: number;
  signal: number;
  macd: number;
  hist: number;
}

function round(value: number): number {
  return +value.toFixed(6);
}

function nextState(
  close: number,
  prev: MacdState | null,
  fastAlpha: number,
  slowAlpha: number,
  signalAlpha: number,
): MacdState {
  if (!prev) {
    return { fast: close, slow: close, signal: 0, macd: 0, hist: 0 };
  }

  const fast = prev.fast + fastAlpha * (close - prev.fast);
  const slow = prev.slow + slowAlpha * (close - prev.slow);
  const macd = fast - slow;
  const signal = prev.signal + signalAlpha * (macd - prev.signal);
  return { fast, slow, signal, macd, hist: macd - signal };
}

function point(time: any, value: number): IndicatorPoint {
  return { time, value: round(value) };
}

function histPoint(time: any, value: number): IndicatorPoint {
  return {
    time,
    value: round(value),
    color: value >= 0 ? 'rgba(227,74,74,.68)' : 'rgba(63,127,214,.68)',
  };
}

function constantRange(bars: readonly ChartBar[]): IndicatorPoint[] {
  if (!bars.length) return [];
  if (bars.length === 1) return [{ time: bars[0].time, value: 0 }];
  return [
    { time: bars[0].time, value: 0 },
    { time: bars[bars.length - 1].time, value: 0 },
  ];
}

function createCalculator(params: IndicatorParams): IndicatorCalculator {
  const fastPeriod = Math.max(1, Math.trunc(Number(params.fastPeriod) || 12));
  const slowPeriod = Math.max(1, Math.trunc(Number(params.slowPeriod) || 26));
  const signalPeriod = Math.max(1, Math.trunc(Number(params.signalPeriod) || 9));
  const fastAlpha = 2 / (fastPeriod + 1);
  const slowAlpha = 2 / (slowPeriod + 1);
  const signalAlpha = 2 / (signalPeriod + 1);
  let states: MacdState[] = [];

  const rebuild = (bars: readonly ChartBar[]): IndicatorOutputData => {
    states = [];
    const macd: IndicatorPoint[] = [];
    const signal: IndicatorPoint[] = [];
    const histogram: IndicatorPoint[] = [];

    for (let i = 0; i < bars.length; i++) {
      const state = nextState(
        bars[i].close,
        i ? states[i - 1] : null,
        fastAlpha,
        slowAlpha,
        signalAlpha,
      );
      states.push(state);
      macd.push(point(bars[i].time, state.macd));
      signal.push(point(bars[i].time, state.signal));
      histogram.push(histPoint(bars[i].time, state.hist));
    }

    return { macd, signal, histogram, zero: constantRange(bars) };
  };

  return {
    reset: rebuild,

    update(bars, change): IndicatorOutputUpdate {
      if (!bars.length) {
        return { macd: null, signal: null, histogram: null, zero: null };
      }

      const i = bars.length - 1;
      const expectedLength = change === 'append' ? bars.length - 1 : bars.length;
      if (states.length !== expectedLength) {
        rebuild(bars);
      } else {
        const prev = i > 0 ? states[i - 1] : null;
        const state = nextState(
          bars[i].close,
          prev,
          fastAlpha,
          slowAlpha,
          signalAlpha,
        );
        if (change === 'append') states.push(state);
        else states[i] = state;
      }

      const state = states[i];
      return {
        macd: point(bars[i].time, state.macd),
        signal: point(bars[i].time, state.signal),
        histogram: histPoint(bars[i].time, state.hist),
        zero: { time: bars[i].time, value: 0 },
      };
    },
  };
}

const plugin: IndicatorPlugin = {
  id: 'macd',
  version: 1,
  label: 'MACD',
  parameters: [
    { key: 'fastPeriod', label: '단기 EMA', type: 'integer', default: 12, min: 1, max: 500, step: 1 },
    { key: 'slowPeriod', label: '장기 EMA', type: 'integer', default: 26, min: 1, max: 1000, step: 1 },
    { key: 'signalPeriod', label: 'Signal', type: 'integer', default: 9, min: 1, max: 500, step: 1 },
  ],
  outputs: [
    {
      id: 'macd',
      label: 'MACD',
      type: 'line',
      pane: 'own',
      options: {
        title: 'MACD',
        color: '#e5c07b',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'signal',
      label: 'Signal',
      type: 'line',
      pane: 'own',
      options: {
        title: 'Signal',
        color: '#56b6c2',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'histogram',
      label: 'Histogram',
      type: 'histogram',
      pane: 'own',
      options: {
        priceLineVisible: false,
        lastValueVisible: false,
        base: 0,
      },
    },
    {
      id: 'zero',
      label: 'Zero',
      type: 'line',
      pane: 'own',
      options: {
        color: 'rgba(171,178,191,.35)',
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
