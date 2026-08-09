import test from 'node:test';
import assert from 'node:assert/strict';
import smaPlugin from '../addons/chart-indicators/plugins/sma';
import emaPlugin from '../addons/chart-indicators/plugins/ema';
import bollingerPlugin from '../addons/chart-indicators/plugins/bollinger';
import rsiPlugin from '../addons/chart-indicators/plugins/rsi';
import obvPlugin from '../addons/chart-indicators/plugins/obv';
import macdPlugin from '../addons/chart-indicators/plugins/macd';
import superTrendPlugin from '../addons/chart-indicators/plugins/supertrend';
import jmaPlugin from '../addons/chart-indicators/plugins/jma';
import dmiPlugin from '../addons/chart-indicators/plugins/dmi';
import disparityPlugin from '../addons/chart-indicators/plugins/disparity';
import type { ChartBar } from '../src/chart/extensions';
import type { IndicatorParams, IndicatorPlugin } from '../addons/chart-indicators/types';

function sampleBars(count: number): ChartBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 1.7 + Math.sin(i / 3) * 4;
    return {
      time: i + 1,
      open: close - Math.sin(i) * 1.5,
      high: close + 2 + Math.abs(Math.sin(i)) * 2,
      low: close - 2 - Math.abs(Math.cos(i)) * 2,
      close,
      volume: 1000 + i * 37,
    };
  });
}

function lastPoint(
  data: Record<string, Array<{ time: any; value: number; color?: string }>>,
  key: string,
) {
  const rows = data[key] ?? [];
  return rows.length ? rows[rows.length - 1] : null;
}

function assertIncrementalParity(plugin: IndicatorPlugin, params: IndicatorParams): void {
  const bars = sampleBars(60);
  const calc = plugin.create(params);
  calc.reset(bars);

  bars.push({
    time: 61,
    open: 194,
    high: 201,
    low: 190,
    close: 198.5,
    volume: 4100,
  });
  const appended = calc.update(bars, 'append');
  const freshAppend = plugin.create(params).reset(bars);
  for (const output of plugin.outputs) {
    assert.deepEqual(
      appended[output.id] ?? null,
      lastPoint(freshAppend, output.id),
      `${plugin.id}/${output.id} append parity`,
    );
  }

  bars[bars.length - 1] = {
    time: 61,
    open: 194,
    high: 197,
    low: 181,
    close: 184.25,
    volume: 4700,
  };
  const replaced = calc.update(bars, 'replace');
  const freshReplace = plugin.create(params).reset(bars);
  for (const output of plugin.outputs) {
    assert.deepEqual(
      replaced[output.id] ?? null,
      lastPoint(freshReplace, output.id),
      `${plugin.id}/${output.id} replace parity`,
    );
  }
}

test('every shipped indicator honors append/replace incremental parity', () => {
  const cases: Array<[IndicatorPlugin, IndicatorParams]> = [
    [smaPlugin, { period: 20, source: 'close' }],
    [emaPlugin, { period: 20, source: 'close' }],
    [bollingerPlugin, { period: 20, multiplier: 2, source: 'close' }],
    [rsiPlugin, { period: 14, signalPeriod: 7, upper: 70, lower: 30 }],
    [obvPlugin, { signalPeriod: 20 }],
    [macdPlugin, { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }],
    [superTrendPlugin, { atrPeriod: 14, multiplier: 2 }],
    [jmaPlugin, { period: 14, phase: 50, power: 2 }],
    [dmiPlugin, { period: 14, strengthLevel: 20 }],
    [disparityPlugin, { period: 20, upper: 105, baseline: 100, lower: 95 }],
  ];

  for (const [plugin, params] of cases) assertIncrementalParity(plugin, params);
});
