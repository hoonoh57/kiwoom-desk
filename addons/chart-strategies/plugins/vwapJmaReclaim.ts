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
}

interface Feature {
  jma: number | null;
  vwap: number | null;
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
  const exitMode = String(params.exitMode ?? 'vwap-close');

  const jma = jmaPlugin.create({ period: jmaPeriod, phase: jmaPhase, power: jmaPower });
  const vwap = vwapPlugin.create({
    stdDev1: 1,
    stdDev2: 2,
    showValue: true,
    showUpper1: false,
    showLower1: false,
    showUpper2: false,
    showLower2: false,
  });

  let features: Feature[] = [];
  let states: MachineState[] = [];
  let signalsByIndex: StrategySignal[][] = [];

  const initial = (session: string): MachineState => ({ phase: 'blocked', session });
  const armed = (session: string): MachineState => ({ phase: 'armed', session });
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

    if (feature.vwap === null) return { state, signals };

    const previousBar = index > 0 ? bars[index - 1] : null;
    const previousVwap = previousFeature?.vwap;
    const sameSession = !!previousBar && sessionOf(previousBar) === session;
    const crossedDown = sameSession
      && previousVwap !== null
      && previousVwap !== undefined
      && previousBar.close >= previousVwap
      && bar.close < feature.vwap;
    const crossedUp = sameSession
      && previousVwap !== null
      && previousVwap !== undefined
      && previousBar.close <= previousVwap
      && bar.close > feature.vwap;

    const previousJma = previousFeature?.jma;
    const jmaRising = feature.jma !== null
      && previousJma !== null
      && previousJma !== undefined
      && feature.jma > previousJma;

    if (state.phase === 'blocked') {
      if (crossedDown) {
        state = armed(session);
        signals.push({
          time: bar.time,
          type: 'arm',
          price: bar.close,
          reason: '종가 VWAP 하향돌파 · 상향 재돌파 대기',
        });
      }
      return { state, signals };
    }

    if (state.phase === 'armed') {
      if (crossedUp && jmaRising) {
        state = { phase: 'long', session };
        signals.push({
          time: bar.time,
          type: 'buy',
          price: bar.close,
          reason: '종가 VWAP 상향 재돌파 · JMA 상승',
        });
      }
      // 상향 재돌파 순간 JMA가 상승이 아니면 추격하지 않는다.
      // ARM은 유지하고 다음 실제 VWAP 상향 재돌파 사건을 기다린다.
      return { state, signals };
    }

    const shouldExit = exitMode === 'jma-close'
      ? feature.jma !== null && bar.close < feature.jma
      : exitMode === 'jma-below-vwap'
        ? feature.jma !== null && feature.jma < feature.vwap && bar.close < feature.jma
        : bar.close < feature.vwap;

    if (shouldExit) {
      const rearm = crossedDown;
      state = rearm ? armed(session) : initial(session);
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
      if (rearm) {
        signals.push({
          time: bar.time,
          type: 'arm',
          price: bar.close,
          reason: '종가 VWAP 하향돌파 · 재진입 상향돌파 대기',
        });
      }
    }
    return { state, signals };
  };

  const rebuild = (bars: readonly ChartBar[]): StrategyEvaluation => {
    const jmaData = jma.reset(bars);
    const vwapData = vwap.reset(bars);
    const jm = pointMap(jmaData.value);
    const vm = pointMap(vwapData.value);

    features = [];
    states = [];
    signalsByIndex = [];

    for (let i = 0; i < bars.length; i++) {
      const time = String(bars[i].time);
      const feature: Feature = {
        jma: jm.has(time) ? jm.get(time)! : null,
        vwap: vm.has(time) ? vm.get(time)! : null,
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
  version: 3,
  label: 'VWAP-JMA Reclaim',
  description: '종가 VWAP 하향돌파 ARM → 종가 VWAP 상향 재돌파 + JMA 상승 BUY → 선택한 구조 이탈 SELL.',
  parameters: [
    { key: 'jmaPeriod', label: 'JMA 기간', type: 'integer', default: 14, min: 1, max: 10_000 },
    { key: 'jmaPhase', label: 'JMA Phase', type: 'integer', default: 50, min: -100, max: 100 },
    { key: 'jmaPower', label: 'JMA Power', type: 'integer', default: 2, min: 1, max: 10_000 },
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
    if (fromVersion < 3) {
      const migrated: StrategyParams = {};
      for (const key of ['jmaPeriod', 'jmaPhase', 'jmaPower', 'exitMode'] as const) {
        const value = params[key];
        if (value !== undefined) migrated[key] = value;
      }
      return migrated;
    }
    return params;
  },
  create: createCalculator,
};

export default plugin;
