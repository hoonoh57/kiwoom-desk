import type { ChartBar } from '../../../src/chart/extensions';
import type {
  IndicatorCalculator,
  IndicatorOutputData,
  IndicatorOutputUpdate,
  IndicatorParams,
  IndicatorPlugin,
  IndicatorPoint,
} from '../types';

function nextObv(prev: number, current: ChartBar, previousBar: ChartBar): number {
  if (current.close > previousBar.close) return prev + current.volume;
  if (current.close < previousBar.close) return prev - current.volume;
  return prev;
}

function signalPoint(
  bars: readonly ChartBar[],
  values: readonly number[],
  index: number,
  signalPeriod: number,
): IndicatorPoint | null {
  if (index < signalPeriod - 1) return null;

  let sum = 0;
  for (let i = index - signalPeriod + 1; i <= index; i++) sum += values[i] ?? 0;
  return { time: bars[index].time, value: +(sum / signalPeriod).toFixed(6) };
}

function createCalculator(params: IndicatorParams): IndicatorCalculator {
  const signalPeriod = Math.max(1, Math.trunc(Number(params.signalPeriod) || 20));
  let values: number[] = [];

  const rebuild = (bars: readonly ChartBar[]): IndicatorOutputData => {
    values = new Array(bars.length).fill(0);
    const obv: IndicatorPoint[] = [];
    const signal: IndicatorPoint[] = [];
    if (!bars.length) return { obv, signal };

    let signalSum = 0;
    obv.push({ time: bars[0].time, value: 0 });
    signalSum += 0;
    if (signalPeriod === 1) signal.push({ time: bars[0].time, value: 0 });

    for (let i = 1; i < bars.length; i++) {
      values[i] = nextObv(values[i - 1], bars[i], bars[i - 1]);
      obv.push({ time: bars[i].time, value: values[i] });

      signalSum += values[i];
      if (i >= signalPeriod) signalSum -= values[i - signalPeriod];
      if (i >= signalPeriod - 1) {
        signal.push({ time: bars[i].time, value: +(signalSum / signalPeriod).toFixed(6) });
      }
    }
    return { obv, signal };
  };

  return {
    reset: rebuild,

    update(bars, change): IndicatorOutputUpdate {
      if (!bars.length) return { obv: null, signal: null };

      const i = bars.length - 1;
      const expectedLength = change === 'append' ? bars.length - 1 : bars.length;
      if (values.length !== expectedLength) {
        rebuild(bars);
      } else if (i === 0) {
        values[0] = 0;
      } else {
        const value = nextObv(values[i - 1], bars[i], bars[i - 1]);
        if (change === 'append') values.push(value);
        else values[i] = value;
      }

      return {
        obv: { time: bars[i].time, value: values[i] ?? 0 },
        signal: signalPoint(bars, values, i, signalPeriod),
      };
    },
  };
}

const plugin: IndicatorPlugin = {
  id: 'obv',
  version: 2,
  label: '누적 거래량 (OBV)',
  parameters: [
    { key: 'signalPeriod', label: 'Signal', type: 'integer', default: 20, min: 1, max: 1000, step: 1 },
  ],
  outputs: [
    {
      id: 'obv',
      label: 'OBV',
      type: 'line',
      pane: 'own',
      options: {
        title: 'OBV',
        color: '#56b6c2',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        priceFormat: { type: 'volume' },
      },
    },
    {
      id: 'signal',
      label: 'Signal',
      type: 'line',
      pane: 'own',
      options: {
        title: 'OBV Signal',
        color: '#e5c07b',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        priceFormat: { type: 'volume' },
      },
    },
  ],
  create: createCalculator,
};

export default plugin;
