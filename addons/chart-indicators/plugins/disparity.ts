import type { ChartBar } from '../../../src/chart/extensions';
import type {
  IndicatorCalculator,
  IndicatorOutputData,
  IndicatorOutputUpdate,
  IndicatorParams,
  IndicatorPlugin,
  IndicatorPoint,
} from '../types';

interface RingState {
  head: number;
  count: number;
  sum: number;
  headValue: number;
}

interface DisparityStep {
  value: number | null;
  movingAverage: number | null;
}

function integerParam(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const integer = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(max, integer));
}

function numberParam(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function constantRange(bars: readonly ChartBar[], value: number): IndicatorPoint[] {
  if (!bars.length) return [];
  if (bars.length === 1) return [{ time: bars[0].time, value }];
  return [
    { time: bars[0].time, value },
    { time: bars[bars.length - 1].time, value },
  ];
}

function createCalculator(params: IndicatorParams): IndicatorCalculator {
  const period = integerParam(params.period, 20, 1, 10_000);
  let upper = numberParam(params.upper, 105, 0, 1000);
  let baseline = numberParam(params.baseline, 100, 0, 1000);
  let lower = numberParam(params.lower, 95, 0, 1000);
  if (!(upper > baseline && baseline > lower)) {
    upper = 105;
    baseline = 100;
    lower = 95;
  }

  const window = new Float32Array(period);
  let head = 0;
  let count = 0;
  let sum = 0;
  let saved: RingState = { head: 0, count: 0, sum: 0, headValue: 0 };

  const clear = () => {
    window.fill(0);
    head = 0;
    count = 0;
    sum = 0;
    saved = { head: 0, count: 0, sum: 0, headValue: 0 };
  };

  const save = () => {
    saved = {
      head,
      count,
      sum,
      headValue: count === period ? window[head] : 0,
    };
  };

  const restore = () => {
    head = saved.head;
    count = saved.count;
    sum = saved.sum;
    if (count === period) window[head] = Math.fround(saved.headValue);
  };

  const step = (bar: ChartBar): DisparityStep => {
    const close = Math.fround(bar.close);
    if (count < period) {
      window[(head + count) % period] = close;
      count++;
      sum += close;
    } else {
      sum += close - window[head];
      window[head] = close;
      head = (head + 1) % period;
    }

    if (count !== period) return { value: null, movingAverage: null };

    const movingAverage = Math.fround(sum / period);
    const value = movingAverage > 0
      ? Math.fround(Math.fround(close / movingAverage) * Math.fround(100))
      : Math.fround(100);
    return { value, movingAverage };
  };

  const rebuild = (bars: readonly ChartBar[]): IndicatorOutputData => {
    clear();
    const value: IndicatorPoint[] = [];

    for (let i = 0; i < bars.length; i++) {
      if (i === bars.length - 1) save();
      const point = step(bars[i]);
      if (point.value !== null) {
        value.push({ time: bars[i].time, value: point.value });
      }
    }

    return {
      value,
      upper: constantRange(bars, upper),
      baseline: constantRange(bars, baseline),
      lower: constantRange(bars, lower),
    };
  };

  return {
    reset: rebuild,

    update(bars, change): IndicatorOutputUpdate {
      if (!bars.length) {
        clear();
        return { value: null, upper: null, baseline: null, lower: null };
      }

      if (change === 'append') {
        save();
      } else {
        restore();
      }

      const last = bars[bars.length - 1];
      const point = step(last);
      return {
        value: point.value === null ? null : { time: last.time, value: point.value },
        upper: { time: last.time, value: upper },
        baseline: { time: last.time, value: baseline },
        lower: { time: last.time, value: lower },
      };
    },
  };
}

const plugin: IndicatorPlugin = {
  id: 'disparity',
  version: 1,
  label: '이격도 (Disparity)',
  parameters: [
    { key: 'period', label: '기간', type: 'integer', default: 20, min: 1, max: 10_000, step: 1 },
    { key: 'upper', label: '상단', type: 'number', default: 105, min: 0, max: 1000, step: 0.1 },
    { key: 'baseline', label: '기준선', type: 'number', default: 100, min: 0, max: 1000, step: 0.1 },
    { key: 'lower', label: '하단', type: 'number', default: 95, min: 0, max: 1000, step: 0.1 },
  ],
  outputs: [
    {
      id: 'value',
      label: 'Disparity',
      type: 'line',
      pane: 'own',
      options: {
        title: 'Disparity',
        color: '#00BFA5',
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
        color: 'rgba(255,235,59,.55)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'baseline',
      label: 'Baseline',
      type: 'line',
      pane: 'own',
      options: {
        color: 'rgba(126,87,194,.70)',
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
        color: 'rgba(255,193,7,.55)',
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
