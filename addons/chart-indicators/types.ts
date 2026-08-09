import type { ChartBar, ChartBarChange } from '../../src/chart/extensions';

export type IndicatorParameterValue = number | string | boolean;
export type IndicatorParams = Record<string, IndicatorParameterValue>;

export interface IndicatorParameterDef {
  key: string;
  label: string;
  type: 'number' | 'integer' | 'select' | 'boolean';
  default: IndicatorParameterValue;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
}

export interface IndicatorPoint {
  time: any;
  value: number;
  color?: string;
}

export interface IndicatorOutputDef {
  id: string;
  label: string;
  type: 'line' | 'histogram';
  pane: 'main' | 'own';
  options?: Record<string, unknown>;
}

export type IndicatorOutputData = Record<string, IndicatorPoint[]>;
export type IndicatorOutputUpdate = Record<string, IndicatorPoint | null>;

export interface IndicatorCalculator {
  reset(bars: readonly ChartBar[]): IndicatorOutputData;
  update(
    bars: readonly ChartBar[],
    change: ChartBarChange,
  ): IndicatorOutputUpdate;
}

export interface IndicatorDefaultInstance {
  instanceId: string;
  params?: IndicatorParams;
  style?: Record<string, Record<string, unknown>>;
}

export interface IndicatorPlugin {
  id: string;
  version: number;
  label: string;
  parameters: IndicatorParameterDef[];
  outputs: IndicatorOutputDef[];
  defaultInstances?: IndicatorDefaultInstance[];
  create(params: IndicatorParams): IndicatorCalculator;
  migrateParams?(
    params: IndicatorParams,
    fromVersion: number,
  ): IndicatorParams;
}

export interface IndicatorInstanceConfig {
  instanceId: string;
  indicatorId: string;
  pluginVersion: number;
  enabled: boolean;
  params: IndicatorParams;
  pane?: 'main' | 'own';
  style?: Record<string, Record<string, unknown>>;
}

export interface IndicatorChartState {
  schemaVersion: 1;
  indicators: IndicatorInstanceConfig[];
}

export interface IndicatorPluginModule {
  default: IndicatorPlugin;
}
