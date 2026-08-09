import type { ChartBar } from '../../../src/chart/extensions';
import type {
  IndicatorCalculator,
  IndicatorOutputData,
  IndicatorOutputUpdate,
  IndicatorParams,
  IndicatorPlugin,
  IndicatorPoint,
} from '../types';

interface JmaState {
  e0: number;
  e1: number;
  e2: number;
  lastJma: number;
  warmSum: number;
  direction: number;
  count: number;
  initialized: boolean;
}

interface StepResult {
  state: JmaState;
  point: IndicatorPoint;
  slope: number;
}

const UP = '#AB47BC';
const DOWN = '#00C853';

function cloneState(state: JmaState | null): JmaState {
  return state
    ? { ...state }
    : {
        e0: 0,
        e1: 0,
        e2: 0,
        lastJma: 0,
        warmSum: 0,
        direction: 0,
        count: 0,
        initialized: false,
      };
}

/** C# Math.Round(value, digits)의 기본 ToEven 계약을 JS에서 재현한다. */
function roundToEven(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;

  let rounded: number;
  if (Math.abs(fraction - 0.5) <= epsilon) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else {
    rounded = Math.round(scaled);
  }
  return rounded / factor;
}

function step(
  previousState: JmaState | null,
  bar: ChartBar,
  period: number,
  phase: number,
  power: number,
): StepResult {
  const state = cloneState(previousState);
  const source = bar.close;

  if (!state.initialized) {
    state.e0 = source;
    state.e1 = 0;
    state.e2 = 0;
    state.lastJma = source;
    state.initialized = true;
  }

  const beta = 0.45 * (period - 1) / (0.45 * (period - 1) + 2);
  const alpha = beta ** power;
  state.e0 = (1 - alpha) * source + alpha * state.e0;
  state.e1 = (source - state.e0) * (1 - beta) + beta * state.e1;
  state.e2 = (
    state.e0
    + (phase / 100 + 1.5) * state.e1
    - state.lastJma
  ) * ((1 - alpha) ** 2) + (alpha ** 2) * state.e2;

  state.count++;
  state.warmSum += source;

  const current = state.count <= period
    ? roundToEven(state.warmSum / state.count, 4)
    : roundToEven(state.e2 + state.lastJma, 4);
  const previous = state.lastJma;

  if (current > previous) state.direction = 1;
  else if (current < previous) state.direction = -1;
  else if (state.direction === 0) state.direction = 1;

  const slope = previous !== 0
    ? roundToEven((current / previous - 1) * 100, 1)
    : 0;

  state.lastJma = current;
  return {
    state,
    slope,
    point: {
      time: bar.time,
      value: current,
      color: state.direction >= 0 ? UP : DOWN,
    },
  };
}

function createCalculator(params: IndicatorParams): IndicatorCalculator {
  const period = Math.max(1, Math.min(10_000, Math.trunc(Number(params.period) || 14)));
  const phase = Math.max(-100, Math.min(100, Math.trunc(Number(params.phase) || 0)));
  const power = Math.max(1, Math.min(10_000, Math.trunc(Number(params.power) || 2)));
  let states: JmaState[] = [];

  const rebuild = (bars: readonly ChartBar[]): IndicatorOutputData => {
    states = [];
    const value: IndicatorPoint[] = [];
    let previous: JmaState | null = null;

    for (const bar of bars) {
      const result = step(previous, bar, period, phase, power);
      states.push(result.state);
      value.push(result.point);
      previous = result.state;
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
        const data = rebuild(bars);
        return { value: data.value[data.value.length - 1] ?? null };
      }

      const previous = index > 0 ? states[index - 1] : null;
      const result = step(previous, bars[index], period, phase, power);
      if (change === 'append') states.push(result.state);
      else states[index] = result.state;
      return { value: result.point };
    },
  };
}

const plugin: IndicatorPlugin = {
  id: 'jma',
  version: 1,
  label: 'Jurik 이동평균 (JMA)',
  parameters: [
    {
      key: 'period',
      label: '기간',
      type: 'integer',
      default: 14,
      min: 1,
      max: 10_000,
      step: 1,
    },
    {
      key: 'phase',
      label: 'Phase',
      type: 'integer',
      default: 50,
      min: -100,
      max: 100,
      step: 1,
    },
    {
      key: 'power',
      label: 'Power',
      type: 'integer',
      default: 2,
      min: 1,
      max: 10_000,
      step: 1,
    },
  ],
  outputs: [
    {
      id: 'value',
      label: 'JMA',
      type: 'line',
      pane: 'main',
      options: {
        title: 'JMA',
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
