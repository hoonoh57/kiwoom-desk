import type { ChartBar } from '../../../src/chart/extensions';
import type {
  IndicatorCalculator,
  IndicatorOutputData,
  IndicatorOutputUpdate,
  IndicatorParams,
  IndicatorPlugin,
  IndicatorPoint,
} from '../types';

function sourceValue(bar: ChartBar, source: string): number {
  switch (source) {
    case 'open': return bar.open;
    case 'high': return bar.high;
    case 'low': return bar.low;
    case 'hl2': return (bar.high + bar.low) / 2;
    case 'hlc3': return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4': return (bar.open + bar.high + bar.low + bar.close) / 4;
    default: return bar.close;
  }
}

function round(value: number): number {
  return +value.toFixed(6);
}

function seed(
  bars: readonly ChartBar[],
  period: number,
  source: string,
): number | null {
  if (bars.length < period) return null;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += sourceValue(bars[i], source);
  return sum / period;
}

function computeValue(
  index: number,
  bars: readonly ChartBar[],
  states: readonly (number | null)[],
  period: number,
  source: string,
): number | null {
  if (index < period - 1) return null;
  if (index === period - 1) return seed(bars, period, source);

  const prev = states[index - 1];
  if (prev === null || prev === undefined) return null;

  const alpha = 2 / (period + 1);
  return alpha * sourceValue(bars[index], source) + (1 - alpha) * prev;
}

function createCalculator(params: IndicatorParams): IndicatorCalculator {
  const period = Math.max(1, Math.trunc(Number(params.period) || 20));
  const source = String(params.source ?? 'close');
  let states: Array<number | null> = [];

  const rebuild = (bars: readonly ChartBar[]): IndicatorOutputData => {
    states = new Array(bars.length).fill(null);
    const value: IndicatorPoint[] = [];

    for (let i = 0; i < bars.length; i++) {
      states[i] = computeValue(i, bars, states, period, source);
      const current = states[i];
      if (current !== null) {
        value.push({ time: bars[i].time, value: round(current) });
      }
    }

    return { value };
  };

  return {
    reset: rebuild,

    update(bars, change): IndicatorOutputUpdate {
      if (!bars.length) return { value: null };

      const index = bars.length - 1;
      const expectedLength = change === 'append' ? bars.length - 1 : bars.length;
      if (states.length !== expectedLength) {
        rebuild(bars);
      } else if (change === 'append') {
        states.push(computeValue(index, bars, states, period, source));
      } else {
        states[index] = computeValue(index, bars, states, period, source);
      }

      const current = states[index];
      return {
        value: current === null || current === undefined
          ? null
          : { time: bars[index].time, value: round(current) },
      };
    },
  };
}

const sourceOptions = [
  { value: 'close', label: '종가' },
  { value: 'open', label: '시가' },
  { value: 'high', label: '고가' },
  { value: 'low', label: '저가' },
  { value: 'hl2', label: 'HL2' },
  { value: 'hlc3', label: 'HLC3' },
  { value: 'ohlc4', label: 'OHLC4' },
];

const plugin: IndicatorPlugin = {
  id: 'ema',
  version: 1,
  label: '지수 이동평균 (EMA)',
  parameters: [
    {
      key: 'period',
      label: '기간',
      type: 'integer',
      default: 20,
      min: 1,
      max: 5000,
      step: 1,
    },
    {
      key: 'source',
      label: '기준값',
      type: 'select',
      default: 'close',
      options: sourceOptions,
    },
  ],
  outputs: [
    {
      id: 'value',
      label: 'EMA',
      type: 'line',
      pane: 'main',
      options: {
        title: 'EMA',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
  ],
  stylePalette: [
    { value: { color: '#61afef' } },
    { value: { color: '#d19a66' } },
    { value: { color: '#c678dd' } },
    { value: { color: '#56b6c2' } },
    { value: { color: '#e06c75' } },
    { value: { color: '#98c379' } },
  ],
  create: createCalculator,
};

export default plugin;
