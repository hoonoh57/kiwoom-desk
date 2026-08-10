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
  };
  order: {
    defaultExchange: SettingsExchange;
    defaultQuantity: number;
    defaultOrderType: string;
  };
}

const PERIODS = new Set<SettingsChartPeriod>(['tick', 'min', 'day', 'week', 'month', 'year']);
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
    },
    order: {
      defaultExchange,
      defaultQuantity: positiveInt(order.defaultQuantity, fallback.order.defaultQuantity, 1_000_000),
      defaultOrderType,
    },
  };
}
