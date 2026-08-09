import type { ChartBar, ChartBarChange } from '../../src/chart/extensions';

export type IndicatorParameterValue = number | string | boolean;
export type IndicatorParams = Record<string, IndicatorParameterValue>;
export type IndicatorSeriesStyle = Record<string, Record<string, unknown>>;

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
  style?: IndicatorSeriesStyle;
}

export interface IndicatorPlugin {
  id: string;
  version: number;
  label: string;
  parameters: IndicatorParameterDef[];
  outputs: IndicatorOutputDef[];
  /** style이 없는 동일 지표 인스턴스에 순서대로 적용되는 안정적인 기본 팔레트 */
  stylePalette?: IndicatorSeriesStyle[];
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
  style?: IndicatorSeriesStyle;
}

export interface IndicatorChartState {
  schemaVersion: 1;
  indicators: IndicatorInstanceConfig[];
}

export interface IndicatorPluginModule {
  default: IndicatorPlugin;
}
