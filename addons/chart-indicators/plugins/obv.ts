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

function createCalculator(_params: IndicatorParams): IndicatorCalculator {
  let values: number[] = [];

  const rebuild = (bars: readonly ChartBar[]): IndicatorOutputData => {
    values = new Array(bars.length).fill(0);
    const points: IndicatorPoint[] = [];
    if (!bars.length) return { obv: points };

    points.push({ time: bars[0].time, value: 0 });
    for (let i = 1; i < bars.length; i++) {
      values[i] = nextObv(values[i - 1], bars[i], bars[i - 1]);
      points.push({ time: bars[i].time, value: values[i] });
    }
    return { obv: points };
  };

  return {
    reset: rebuild,

    update(bars, change): IndicatorOutputUpdate {
      if (!bars.length) return { obv: null };

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

      return { obv: { time: bars[i].time, value: values[i] ?? 0 } };
    },
  };
}

const plugin: IndicatorPlugin = {
  id: 'obv',
  version: 1,
  label: '누적 거래량 (OBV)',
  parameters: [],
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
  ],
  create: createCalculator,
};

export default plugin;
