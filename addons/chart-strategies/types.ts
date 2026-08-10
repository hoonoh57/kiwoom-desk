import type { ChartBar, ChartBarChange } from '../../src/chart/extensions';
import type { StrategyExecutionMode } from '../../src/core/events';

export type StrategyParamValue = string | number | boolean;
export type StrategyParams = Record<string, StrategyParamValue>;

export interface StrategyParameterDef {
  key: string;
  label: string;
  type: 'integer' | 'number' | 'boolean' | 'select';
  default: StrategyParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
}

export type StrategySignalType = 'arm' | 'buy' | 'sell' | 'fail';

export interface StrategySignal {
  time: any;
  type: StrategySignalType;
  price: number;
  reason: string;
}

export interface StrategyEvaluation {
  /** 현재 전체 신호 스냅샷. reset과 live update 모두 동일 계약을 사용한다. */
  signals: readonly StrategySignal[];
}

export interface StrategyCalculator {
  reset(bars: readonly ChartBar[]): StrategyEvaluation;
  update(bars: readonly ChartBar[], change: ChartBarChange): StrategyEvaluation;
}

export interface StrategyPlugin {
  id: string;
  version: number;
  label: string;
  description?: string;
  parameters: StrategyParameterDef[];
  create(params: StrategyParams): StrategyCalculator;
  migrateParams?(
    params: StrategyParams,
    fromVersion: number,
  ): StrategyParams;
}

export interface StrategyPluginModule {
  default: StrategyPlugin;
}

export interface StrategyExecutionConfig {
  mode: StrategyExecutionMode;
  qty: number;
  exchange: 'KRX' | 'NXT' | 'SOR';
  orderType: string;
}

export interface StrategyInstanceConfig {
  instanceId: string;
  strategyId: string;
  pluginVersion: number;
  enabled: boolean;
  params: StrategyParams;
  execution: StrategyExecutionConfig;
  showMarkers: boolean;
  order: number;
}

export interface StrategyChartState {
  schemaVersion: 1;
  strategies: StrategyInstanceConfig[];
}
