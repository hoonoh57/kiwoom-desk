export const WORKBENCH_SETTINGS_SCHEMA_VERSION = 1;

export type SettingsChartPeriod = 'tick' | 'min' | 'day' | 'week' | 'month' | 'year';
export type SettingsExchange = 'KRX' | 'NXT' | 'SOR';

export interface WorkbenchSettings {
  schemaVersion: 1;
  general: {
    defaultSymbol: string;
    restoreLayout: boolean;
  };
  chart: {
    defaultPeriod: SettingsChartPeriod;
    defaultMinuteScope: string;
    defaultTickScope: string;
    adjustedPrice: boolean;
    volumeRaw: boolean;
    watchlistOpenPeriod: SettingsChartPeriod;
  };
  order: {
    defaultExchange: SettingsExchange;
    defaultQuantity: number;
    defaultOrderType: string;
  };
}

const PERIODS = new Set<SettingsChartPeriod>(['tick', 'min', 'day', 'week', 'month', 'year']);
const MINUTE_SCOPES = new Set(['1', '3', '5', '10', '15', '30', '60']);
const TICK_SCOPES = new Set(['1', '3', '5', '10', '30', '60', '120', '240', '360', '480', '540', '720']);
const EXCHANGES = new Set<SettingsExchange>(['KRX', 'NXT', 'SOR']);
const ORDER_TYPES = new Set(['0', '3', '5', '6', '7', '10', '13', '20', '23']);

export function defaultWorkbenchSettings(): WorkbenchSettings {
  return {
    schemaVersion: WORKBENCH_SETTINGS_SCHEMA_VERSION,
    general: {
      defaultSymbol: '005930',
      restoreLayout: true,
    },
    chart: {
      defaultPeriod: 'day',
      defaultMinuteScope: '5',
      defaultTickScope: '120',
      adjustedPrice: true,
      volumeRaw: false,
      watchlistOpenPeriod: 'day',
    },
    order: {
      defaultExchange: 'KRX',
      defaultQuantity: 1,
      defaultOrderType: '3',
    },
  };
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown, fallback: string, max = 40): string {
  const raw = String(value ?? '').trim();
  return (raw || fallback).slice(0, max);
}

function symbol(value: unknown, fallback: string): string {
  const raw = text(value, fallback, 20).toUpperCase().replace(/^A(?=\d{6}(?:_|$))/, '');
  return raw || fallback;
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

export function normalizeWorkbenchSettings(value: unknown): WorkbenchSettings {
  const fallback = defaultWorkbenchSettings();
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as any;
  const general = raw.general && typeof raw.general === 'object' ? raw.general : {};
  const chart = raw.chart && typeof raw.chart === 'object' ? raw.chart : {};
  const order = raw.order && typeof raw.order === 'object' ? raw.order : {};

  const defaultPeriod = PERIODS.has(chart.defaultPeriod as SettingsChartPeriod)
    ? chart.defaultPeriod as SettingsChartPeriod
    : fallback.chart.defaultPeriod;
  const watchlistOpenPeriod = PERIODS.has(chart.watchlistOpenPeriod as SettingsChartPeriod)
    ? chart.watchlistOpenPeriod as SettingsChartPeriod
    : fallback.chart.watchlistOpenPeriod;
  const defaultMinuteScope = MINUTE_SCOPES.has(String(chart.defaultMinuteScope ?? ''))
    ? String(chart.defaultMinuteScope)
    : fallback.chart.defaultMinuteScope;
  const defaultTickScope = TICK_SCOPES.has(String(chart.defaultTickScope ?? ''))
    ? String(chart.defaultTickScope)
    : fallback.chart.defaultTickScope;
  const defaultExchange = EXCHANGES.has(order.defaultExchange as SettingsExchange)
    ? order.defaultExchange as SettingsExchange
    : fallback.order.defaultExchange;
  const defaultOrderType = ORDER_TYPES.has(String(order.defaultOrderType ?? ''))
    ? String(order.defaultOrderType)
    : fallback.order.defaultOrderType;

  return {
    schemaVersion: WORKBENCH_SETTINGS_SCHEMA_VERSION,
    general: {
      defaultSymbol: symbol(general.defaultSymbol, fallback.general.defaultSymbol),
      restoreLayout: bool(general.restoreLayout, fallback.general.restoreLayout),
    },
    chart: {
      defaultPeriod,
      defaultMinuteScope,
      defaultTickScope,
      adjustedPrice: bool(chart.adjustedPrice, fallback.chart.adjustedPrice),
      volumeRaw: bool(chart.volumeRaw, fallback.chart.volumeRaw),
      watchlistOpenPeriod,
    },
    order: {
      defaultExchange,
      defaultQuantity: positiveInt(order.defaultQuantity, fallback.order.defaultQuantity, 1_000_000),
      defaultOrderType,
    },
  };
}
