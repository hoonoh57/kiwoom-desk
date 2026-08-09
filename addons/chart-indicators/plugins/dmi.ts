import type { ChartBar } from '../../../src/chart/extensions';
import type {
  IndicatorCalculator,
  IndicatorOutputData,
  IndicatorOutputUpdate,
  IndicatorParams,
  IndicatorPlugin,
  IndicatorPoint,
} from '../types';

interface DirectionalMove {
  tr: number;
  plusDm: number;
  minusDm: number;
}

interface DmiState {
  smoothTr: number;
  smoothPlusDm: number;
  smoothMinusDm: number;
  plusDi: number;
  minusDi: number;
  dx: number;
  adx: number | null;
}

function round(value: number): number {
  return +value.toFixed(6);
}

function directionalMove(bars: readonly ChartBar[], index: number): DirectionalMove {
  const current = bars[index];
  const previous = bars[index - 1];
  const upMove = current.high - previous.high;
  const downMove = previous.low - current.low;

  return {
    tr: Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ),
    plusDm: upMove > downMove && upMove > 0 ? upMove : 0,
    minusDm: downMove > upMove && downMove > 0 ? downMove : 0,
  };
}

function diValues(
  smoothTr: number,
  smoothPlusDm: number,
  smoothMinusDm: number,
): Pick<DmiState, 'plusDi' | 'minusDi' | 'dx'> {
  if (smoothTr <= 0) return { plusDi: 0, minusDi: 0, dx: 0 };

  const plusDi = 100 * smoothPlusDm / smoothTr;
  const minusDi = 100 * smoothMinusDm / smoothTr;
  const sum = plusDi + minusDi;
  const dx = sum <= 0 ? 0 : 100 * Math.abs(plusDi - minusDi) / sum;
  return { plusDi, minusDi, dx };
}

function seedState(
  bars: readonly ChartBar[],
  period: number,
): DmiState | null {
  if (bars.length <= period) return null;

  let smoothTr = 0;
  let smoothPlusDm = 0;
  let smoothMinusDm = 0;
  for (let i = 1; i <= period; i++) {
    const move = directionalMove(bars, i);
    smoothTr += move.tr;
    smoothPlusDm += move.plusDm;
    smoothMinusDm += move.minusDm;
  }

  const values = diValues(smoothTr, smoothPlusDm, smoothMinusDm);
  return {
    smoothTr,
    smoothPlusDm,
    smoothMinusDm,
    ...values,
    adx: period === 1 ? values.dx : null,
  };
}

function computeState(
  index: number,
  bars: readonly ChartBar[],
  states: readonly (DmiState | null)[],
  period: number,
): DmiState | null {
  if (index < period) return null;
  if (index === period) return seedState(bars, period);

  const prev = states[index - 1];
  if (!prev) return null;

  const move = directionalMove(bars, index);
  const smoothTr = prev.smoothTr - (prev.smoothTr / period) + move.tr;
  const smoothPlusDm = prev.smoothPlusDm - (prev.smoothPlusDm / period) + move.plusDm;
  const smoothMinusDm = prev.smoothMinusDm - (prev.smoothMinusDm / period) + move.minusDm;
  const values = diValues(smoothTr, smoothPlusDm, smoothMinusDm);

  let adx: number | null = null;
  const firstAdxIndex = period * 2 - 1;
  if (index === firstAdxIndex) {
    let dxSum = values.dx;
    for (let i = period; i < index; i++) dxSum += states[i]?.dx ?? 0;
    adx = dxSum / period;
  } else if (index > firstAdxIndex && prev.adx !== null) {
    adx = ((prev.adx * (period - 1)) + values.dx) / period;
  }

  return {
    smoothTr,
    smoothPlusDm,
    smoothMinusDm,
    ...values,
    adx,
  };
}

function buildStates(
  bars: readonly ChartBar[],
  period: number,
): Array<DmiState | null> {
  const states: Array<DmiState | null> = new Array(bars.length).fill(null);
  for (let i = period; i < bars.length; i++) {
    states[i] = computeState(i, bars, states, period);
  }
  return states;
}

function point(time: any, value: number): IndicatorPoint {
  return { time, value: round(value) };
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
  const period = Math.max(1, Math.trunc(Number(params.period) || 14));
  const strengthLevel = Math.max(0, Math.min(100, Number(params.strengthLevel) || 20));
  let states: Array<DmiState | null> = [];

  const rebuild = (bars: readonly ChartBar[]): IndicatorOutputData => {
    states = buildStates(bars, period);
    const plusDi: IndicatorPoint[] = [];
    const minusDi: IndicatorPoint[] = [];
    const adx: IndicatorPoint[] = [];

    for (let i = period; i < bars.length; i++) {
      const state = states[i];
      if (!state) continue;
      plusDi.push(point(bars[i].time, state.plusDi));
      minusDi.push(point(bars[i].time, state.minusDi));
      if (state.adx !== null) adx.push(point(bars[i].time, state.adx));
    }

    return {
      plusDi,
      minusDi,
      adx,
      strength: constantRange(bars, strengthLevel),
    };
  };

  return {
    reset: rebuild,

    update(bars, change): IndicatorOutputUpdate {
      if (!bars.length) return { plusDi: null, minusDi: null, adx: null, strength: null };

      const index = bars.length - 1;
      const expectedLength = change === 'append' ? bars.length - 1 : bars.length;
      if (states.length !== expectedLength) {
        rebuild(bars);
      } else if (change === 'append') {
        states.push(computeState(index, bars, states, period));
      } else {
        states[index] = computeState(index, bars, states, period);
      }

      const state = states[index];
      return {
        plusDi: state ? point(bars[index].time, state.plusDi) : null,
        minusDi: state ? point(bars[index].time, state.minusDi) : null,
        adx: state?.adx !== null && state?.adx !== undefined
          ? point(bars[index].time, state.adx)
          : null,
        strength: { time: bars[index].time, value: strengthLevel },
      };
    },
  };
}

const plugin: IndicatorPlugin = {
  id: 'dmi',
  version: 1,
  label: 'DMI / ADX',
  parameters: [
    { key: 'period', label: '기간', type: 'integer', default: 14, min: 1, max: 500, step: 1 },
    { key: 'strengthLevel', label: 'ADX 기준', type: 'number', default: 20, min: 0, max: 100, step: 1 },
  ],
  outputs: [
    {
      id: 'plusDi',
      label: '+DI',
      type: 'line',
      pane: 'own',
      options: {
        title: '+DI',
        color: '#e34a4a',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'minusDi',
      label: '-DI',
      type: 'line',
      pane: 'own',
      options: {
        title: '-DI',
        color: '#3f7fd6',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'adx',
      label: 'ADX',
      type: 'line',
      pane: 'own',
      options: {
        title: 'ADX',
        color: '#e5c07b',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      },
    },
    {
      id: 'strength',
      label: 'ADX 기준',
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
