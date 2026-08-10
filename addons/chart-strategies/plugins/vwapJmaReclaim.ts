import type { ChartBar, ChartBarChange } from '../../../src/chart/extensions';
import jmaPlugin from '../../chart-indicators/plugins/jma';
import vwapPlugin from '../../chart-indicators/plugins/vwap';
import type { IndicatorPoint } from '../../chart-indicators/types';
import type {
  StrategyCalculator,
  StrategyEvaluation,
  StrategyParams,
  StrategyPlugin,
  StrategySignal,
} from '../types';

type Phase = 'blocked' | 'armed' | 'long';

interface MachineState {
  phase: Phase;
  session: string;
  armedIndex: number;
}

interface Feature {
  jma: number | null;
  vwap: number | null;
  upper1: number | null;
}

function sessionOf(bar: ChartBar): string {
  const explicit = String(bar.tradingDate ?? '').trim();
  if (explicit) return explicit;
  if (typeof bar.time === 'number' && Number.isFinite(bar.time)) {
    return new Date(Math.trunc(bar.time) * 1000).toISOString().slice(0, 10);
  }
  return String(bar.time ?? '').slice(0, 10);
}

function valueOf(point: IndicatorPoint | null | undefined): number | null {
  const n = Number(point?.value);
  return Number.isFinite(n) ? n : null;
}

function boolParam(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberParam(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  const v = Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, v));
}

function integerParam(value: unknown, fallback: number, min: number, max: number): number {
  return Math.trunc(numberParam(value, fallback, min, max));
}

function pointMap(rows: IndicatorPoint[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows ?? []) map.set(String(row.time), Number(row.value));
  return map;
}

function createCalculator(params: StrategyParams): StrategyCalculator {
  const jmaPeriod = integerParam(params.jmaPeriod, 14, 1, 10_000);
  const jmaPhase = integerParam(params.jmaPhase, 50, -100, 100);
  const jmaPower = integerParam(params.jmaPower, 2, 1, 10_000);
  const requireJmaAboveVwap = boolParam(params.requireJmaAboveVwap, false);
  const maxEntrySigma = numberParam(params.maxEntrySigma, 1, -10, 10);
  const armExpiryBars = integerParam(params.armExpiryBars, 12, 1, 10_000);
  const exitMode = String(params.exitMode ?? 'vwap-close');

  const jma = jmaPlugin.create({ period: jmaPeriod, phase: jmaPhase, power: jmaPower });
  const vwap = vwapPlugin.create({
    stdDev1: 1,
    stdDev2: 2,
    showValue: true,
    showUpper1: true,
    showLower1: false,
    showUpper2: false,
    showLower2: false,
  });

  let features: Feature[] = [];
  let states: MachineState[] = [];
  let signalsByIndex: StrategySignal[][] = [];

  const initial = (session: string): MachineState => ({
    phase: 'blocked',
    session,
    armedIndex: -1,
  });

  const flatten = (): StrategySignal[] => signalsByIndex.flat();

  const evaluate = (
    index: number,
    bars: readonly ChartBar[],
    feature: Feature,
    previousFeature: Feature | null,
    previousState: MachineState | null,
  ): { state: MachineState; signals: StrategySignal[] } => {
    const bar = bars[index];
    const session = sessionOf(bar);
    let state = previousState && previousState.session === session
      ? { ...previousState }
      : initial(session);
    const signals: StrategySignal[] = [];

    if (feature.jma === null || feature.vwap === null) return { state, signals };

    const prevJma = previousFeature?.jma;
    const jmaSlope = prevJma !== null && prevJma !== undefined
      ? feature.jma - prevJma
      : 0;
    const sigma = feature.upper1 !== null ? feature.upper1 - feature.vwap : 0;
    const z = sigma > 0 ? (bar.close - feature.vwap) / sigma : 0;

    if (state.phase === 'blocked') {
      if (bar.close < feature.vwap && jmaSlope > 0) {
        state = { phase: 'armed', session, armedIndex: index };
        signals.push({
          time: bar.time,
          type: 'arm',
          price: bar.close,
          reason: 'VWAP 아래에서 JMA 기울기 상승 전환',
        });
      }
      return { state, signals };
    }

    if (state.phase === 'armed') {
      const age = index - state.armedIndex;
      const previousBar = index > 0 ? bars[index - 1] : null;
      const previousVwap = previousFeature?.vwap;
      const reclaimed = !!previousBar
        && previousVwap !== null
        && previousVwap !== undefined
        && previousBar.close <= previousVwap
        && bar.close > feature.vwap;
      const confirmed = reclaimed
        && bar.close > feature.jma
        && jmaSlope > 0
        && (!requireJmaAboveVwap || feature.jma >= feature.vwap)
        && z <= maxEntrySigma;

      if (confirmed) {
        state = { phase: 'long', session, armedIndex: state.armedIndex };
        signals.push({
          time: bar.time,
          type: 'buy',
          price: bar.close,
          reason: `VWAP 상향 재돌파 · Price>JMA · JMA상승 · z=${z.toFixed(2)}`,
        });
        return { state, signals };
      }

      // 재돌파 순간에 확인조건이 부족하면 나중에 오른 자리에서 추격하지 않는다.
      // 다음 실제 VWAP 재돌파가 나오기 전까지 ARM 상태를 유지한다.
      if (age > armExpiryBars || (jmaSlope <= 0 && bar.close < feature.jma)) {
        state = initial(session);
        signals.push({
          time: bar.time,
          type: 'fail',
          price: bar.close,
          reason: age > armExpiryBars ? 'ARM 유효봉 초과' : 'JMA 재하락으로 reclaim 실패',
        });
      }
      return { state, signals };
    }

    const shouldExit = exitMode === 'jma-close'
      ? bar.close < feature.jma
      : exitMode === 'jma-below-vwap'
        ? feature.jma < feature.vwap && bar.close < feature.jma
        : bar.close < feature.vwap;

    if (shouldExit) {
      state = initial(session);
      signals.push({
        time: bar.time,
        type: 'sell',
        price: bar.close,
        reason: exitMode === 'jma-close'
          ? '종가 JMA 이탈'
          : exitMode === 'jma-below-vwap'
            ? 'JMA<VWAP 및 종가 JMA 이탈'
            : '종가 VWAP 이탈',
      });
    }
    return { state, signals };
  };

  const rebuild = (bars: readonly ChartBar[]): StrategyEvaluation => {
    const jmaData = jma.reset(bars);
    const vwapData = vwap.reset(bars);
    const jm = pointMap(jmaData.value);
    const vm = pointMap(vwapData.value);
    const um = pointMap(vwapData.upper1);

    features = [];
    states = [];
    signalsByIndex = [];

    for (let i = 0; i < bars.length; i++) {
      const time = String(bars[i].time);
      const feature: Feature = {
        jma: jm.has(time) ? jm.get(time)! : null,
        vwap: vm.has(time) ? vm.get(time)! : null,
        upper1: um.has(time) ? um.get(time)! : null,
      };
      const result = evaluate(
        i,
        bars,
        feature,
        i > 0 ? features[i - 1] : null,
        i > 0 ? states[i - 1] : null,
      );
      features.push(feature);
      states.push(result.state);
      signalsByIndex.push(result.signals);
    }

    return { signals: flatten() };
  };

  return {
    reset: rebuild,

    update(bars: readonly ChartBar[], change: ChartBarChange): StrategyEvaluation {
      if (!bars.length) return rebuild(bars);
      const index = bars.length - 1;
      const expected = change === 'append' ? bars.length - 1 : bars.length;
      if (features.length !== expected || states.length !== expected || signalsByIndex.length !== expected) {
        return rebuild(bars);
      }

      const ju = jma.update(bars, change);
      const vu = vwap.update(bars, change);
      const feature: Feature = {
        jma: valueOf(ju.value),
        vwap: valueOf(vu.value),
        upper1: valueOf(vu.upper1),
      };
      const result = evaluate(
        index,
        bars,
        feature,
        index > 0 ? features[index - 1] : null,
        index > 0 ? states[index - 1] : null,
      );

      if (change === 'append') {
        features.push(feature);
        states.push(result.state);
        signalsByIndex.push(result.signals);
      } else {
        features[index] = feature;
        states[index] = result.state;
        signalsByIndex[index] = result.signals;
      }

      return { signals: flatten() };
    },
  };
}

const plugin: StrategyPlugin = {
  id: 'vwap-jma-reclaim',
  version: 2,
  label: 'VWAP-JMA Reclaim',
  description: 'VWAP 아래 JMA 상승 ARM → 실제 VWAP 상향 재돌파 봉에서 JMA 상승 확인 BUY → 구조 이탈 SELL.',
  parameters: [
    { key: 'jmaPeriod', label: 'JMA 기간', type: 'integer', default: 14, min: 1, max: 10_000 },
    { key: 'jmaPhase', label: 'JMA Phase', type: 'integer', default: 50, min: -100, max: 100 },
    { key: 'jmaPower', label: 'JMA Power', type: 'integer', default: 2, min: 1, max: 10_000 },
    { key: 'requireJmaAboveVwap', label: 'JMA>VWAP 추가확인(엄격)', type: 'boolean', default: false },
    { key: 'maxEntrySigma', label: '최대 진입 σ', type: 'number', default: 1, min: -10, max: 10, step: 0.1 },
    { key: 'armExpiryBars', label: 'ARM 유효봉', type: 'integer', default: 12, min: 1, max: 10_000 },
    {
      key: 'exitMode',
      label: '청산 기준',
      type: 'select',
      default: 'vwap-close',
      options: [
        { value: 'vwap-close', label: '종가 VWAP 이탈' },
        { value: 'jma-close', label: '종가 JMA 이탈' },
        { value: 'jma-below-vwap', label: 'JMA<VWAP + 종가 JMA 이탈' },
      ],
    },
  ],
  migrateParams(params, fromVersion) {
    if (fromVersion < 2) {
      return {
        ...params,
        requireJmaAboveVwap: false,
      };
    }
    return params;
  },
  create: createCalculator,
};

export default plugin;
