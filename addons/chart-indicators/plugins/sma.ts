import type { ChartBar } from '../../../src/chart/extensions';
import type {
  IndicatorCalculator,
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

function point(
  bars: readonly ChartBar[],
  period: number,
  source: string,
): IndicatorPoint | null {
  if (bars.length < period) return null;

  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    sum += sourceValue(bars[i], source);
  }

  return {
    time: bars[bars.length - 1].time,
    value: +(sum / period).toFixed(6),
  };
}

function createCalculator(params: IndicatorParams): IndicatorCalculator {
  const period = Math.max(1, Math.trunc(Number(params.period) || 1));
  const source = String(params.source ?? 'close');

  return {
    reset(bars) {
      const values: IndicatorPoint[] = [];
      let sum = 0;

      for (let i = 0; i < bars.length; i++) {
        sum += sourceValue(bars[i], source);
        if (i >= period) sum -= sourceValue(bars[i - period], source);
        if (i >= period - 1) {
          values.push({
            time: bars[i].time,
            value: +(sum / period).toFixed(6),
          });
        }
      }

      return { value: values };
    },

    update(bars) {
      return { value: point(bars, period, source) };
    },
  };
}

const plugin: IndicatorPlugin = {
  id: 'sma',
  version: 1,
  label: '단순 이동평균 (SMA)',
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
      options: [
        { value: 'close', label: '종가' },
        { value: 'open', label: '시가' },
        { value: 'high', label: '고가' },
        { value: 'low', label: '저가' },
        { value: 'hl2', label: 'HL2' },
        { value: 'hlc3', label: 'HLC3' },
        { value: 'ohlc4', label: 'OHLC4' },
      ],
    },
  ],
  outputs: [
    {
      id: 'value',
      label: 'SMA',
      type: 'line',
      pane: 'main',
      options: {
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
    },
  ],
  stylePalette: [
    { value: { color: '#e5c07b' } },
    { value: { color: '#98c379' } },
    { value: { color: '#c678dd' } },
    { value: { color: '#56b6c2' } },
    { value: { color: '#d19a66' } },
    { value: { color: '#e06c75' } },
    { value: { color: '#61afef' } },
    { value: { color: '#abb2bf' } },
  ],
  defaultInstances: [
    {
      instanceId: 'sma-5',
      params: { period: 5, source: 'close' },
      style: { value: { color: '#e5c07b' } },
    },
    {
      instanceId: 'sma-20',
      params: { period: 20, source: 'close' },
      style: { value: { color: '#98c379' } },
    },
    {
      instanceId: 'sma-60',
      params: { period: 60, source: 'close' },
      style: { value: { color: '#c678dd' } },
    },
  ],
  create: createCalculator,
};

export default plugin;
