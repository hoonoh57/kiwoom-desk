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

interface BandPoint {
  basis: IndicatorPoint;
  upper: IndicatorPoint;
  lower: IndicatorPoint;
}

function makeBandPoint(
  time: any,
  sum: number,
  sumSq: number,
  period: number,
  multiplier: number,
): BandPoint {
  const mean = sum / period;
  const variance = Math.max(0, sumSq / period - mean * mean);
  const deviation = Math.sqrt(variance);
  return {
    basis: { time, value: round(mean) },
    upper: { time, value: round(mean + multiplier * deviation) },
    lower: { time, value: round(mean - multiplier * deviation) },
  };
}

function lastBand(
  bars: readonly ChartBar[],
  period: number,
  multiplier: number,
  source: string,
): BandPoint | null {
  if (bars.length < period) return null;

  let sum = 0;
  let sumSq = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const value = sourceValue(bars[i], source);
    sum += value;
    sumSq += value * value;
  }
  return makeBandPoint(bars[bars.length - 1].time, sum, sumSq, period, multiplier);
}

function createCalculator(params: IndicatorParams): IndicatorCalculator {
  const period = Math.max(1, Math.trunc(Number(params.period) || 20));
  const multiplier = Math.max(0, Number(params.multiplier) || 2);
  const source = String(params.source ?? 'close');

  const rebuild = (bars: readonly ChartBar[]): IndicatorOutputData => {
    const basis: IndicatorPoint[] = [];
    const upper: IndicatorPoint[] = [];
    const lower: IndicatorPoint[] = [];
    let sum = 0;
    let sumSq = 0;

    for (let i = 0; i < bars.length; i++) {
      const value = sourceValue(bars[i], source);
      sum += value;
      sumSq += value * value;

      if (i >= period) {
        const old = sourceValue(bars[i - period], source);
        sum -= old;
        sumSq -= old * old;
      }

      if (i >= period - 1) {
        const point = makeBandPoint(bars[i].time, sum, sumSq, period, multiplier);
        basis.push(point.basis);
        upper.push(point.upper);
        lower.push(point.lower);
      }
    }

    return { basis, upper, lower };
  };

  return {
    reset: rebuild,

    update(bars): IndicatorOutputUpdate {
      const point = lastBand(bars, period, multiplier, source);
      return point ?? { basis: null, upper: null, lower: null };
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
  id: 'bollinger',
  version: 1,
  label: '볼린저 밴드 (Bollinger Bands)',
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
      key: 'multiplier',
      label: '표준편차 배수',
      type: 'number',
      default: 2,
      min: 0,
      max: 20,
      step: 0.1,
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
      id: 'basis',
      label: 'Basis',
      type: 'line',
      pane: 'main',
      options: {
        title: 'BB Basis',
        color: '#e5c07b',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'upper',
      label: 'Upper',
      type: 'line',
      pane: 'main',
      options: {
        title: 'BB Upper',
        color: 'rgba(224,108,117,.85)',
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
      pane: 'main',
      options: {
        title: 'BB Lower',
        color: 'rgba(97,175,239,.85)',
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
