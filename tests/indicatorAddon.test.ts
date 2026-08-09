import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import smaPlugin from '../addons/chart-indicators/plugins/sma';
import rsiPlugin from '../addons/chart-indicators/plugins/rsi';
import obvPlugin from '../addons/chart-indicators/plugins/obv';
import macdPlugin from '../addons/chart-indicators/plugins/macd';
import superTrendPlugin from '../addons/chart-indicators/plugins/supertrend';
import dmiPlugin from '../addons/chart-indicators/plugins/dmi';
import type { ChartBar } from '../src/chart/extensions';
import type { IndicatorParams, IndicatorPlugin } from '../addons/chart-indicators/types';

function bar(time: number, close: number, volume = 1): ChartBar {
  return {
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume,
  };
}

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

function assertIncrementalParity(
  plugin: IndicatorPlugin,
  params: IndicatorParams,
): void {
  const bars = sampleBars(40);
  const calc = plugin.create(params);
  calc.reset(bars);

  bars.push({
    time: 41,
    open: 168,
    high: 175,
    low: 165,
    close: 172.5,
    volume: 3100,
  });
  const appended = calc.update(bars, 'append');
  const freshAfterAppend = plugin.create(params).reset(bars);
  for (const output of plugin.outputs) {
    assert.deepEqual(
      appended[output.id] ?? null,
      lastPoint(freshAfterAppend, output.id),
      `${plugin.id}/${output.id} append parity`,
    );
  }

  bars[bars.length - 1] = {
    time: 41,
    open: 168,
    high: 171,
    low: 160,
    close: 164.25,
    volume: 3550,
  };
  const replaced = calc.update(bars, 'replace');
  const freshAfterReplace = plugin.create(params).reset(bars);
  for (const output of plugin.outputs) {
    assert.deepEqual(
      replaced[output.id] ?? null,
      lastPoint(freshAfterReplace, output.id),
      `${plugin.id}/${output.id} replace parity`,
    );
  }
}

test('SMA plugin preserves the former MA5/20/60 defaults', () => {
  const periods = (smaPlugin.defaultInstances ?? [])
    .map(x => Number(x.params?.period))
    .sort((a, b) => a - b);

  assert.deepEqual(periods, [5, 20, 60]);
});

test('SMA plugin has distinct fallback colors for existing saved instances', () => {
  const colors = (smaPlugin.stylePalette ?? [])
    .slice(0, 3)
    .map(style => String(style.value?.color ?? ''));

  assert.equal(colors.length, 3);
  assert.equal(new Set(colors).size, 3);
  assert.ok(colors.every(Boolean));
});

test('SMA plugin reset and incremental update agree', () => {
  const calc = smaPlugin.create({ period: 3, source: 'close' });
  const bars: ChartBar[] = [
    bar(1, 10),
    bar(2, 20),
    bar(3, 30),
    bar(4, 40),
  ];

  const reset = calc.reset(bars);
  assert.deepEqual(reset.value, [
    { time: 3, value: 20 },
    { time: 4, value: 30 },
  ]);

  bars.push(bar(5, 50));
  assert.deepEqual(calc.update(bars, 'append').value, { time: 5, value: 40 });

  bars[bars.length - 1].close = 80;
  bars[bars.length - 1].open = 80;
  bars[bars.length - 1].high = 80;
  bars[bars.length - 1].low = 80;
  assert.deepEqual(calc.update(bars, 'replace').value, { time: 5, value: 50 });
});

test('RSI has a distinct signal average and append/replace remain incremental-parity safe', () => {
  assert.ok(rsiPlugin.outputs.every(x => x.pane === 'own'));
  assert.deepEqual(rsiPlugin.outputs.map(x => x.id), ['rsi', 'signal', 'upper', 'lower']);
  assert.notEqual(
    String(rsiPlugin.outputs.find(x => x.id === 'rsi')?.options?.color),
    String(rsiPlugin.outputs.find(x => x.id === 'signal')?.options?.color),
  );
  assertIncrementalParity(rsiPlugin, { period: 14, signalPeriod: 7, upper: 70, lower: 30 });

  const rising = Array.from({ length: 22 }, (_, i) => bar(i + 1, 100 + i));
  const result = rsiPlugin.create({ period: 14, signalPeriod: 7, upper: 70, lower: 30 }).reset(rising);
  assert.equal(result.rsi[result.rsi.length - 1]?.value, 100);
  assert.equal(result.signal[result.signal.length - 1]?.value, 100);
});

test('OBV has a distinct signal average and append/replace remain incremental-parity safe', () => {
  assert.ok(obvPlugin.outputs.every(x => x.pane === 'own'));
  assert.deepEqual(obvPlugin.outputs.map(x => x.id), ['obv', 'signal']);
  assert.notEqual(
    String(obvPlugin.outputs.find(x => x.id === 'obv')?.options?.color),
    String(obvPlugin.outputs.find(x => x.id === 'signal')?.options?.color),
  );
  assertIncrementalParity(obvPlugin, { signalPeriod: 20 });

  const bars = [bar(1, 10, 100), bar(2, 11, 200), bar(3, 9, 50), bar(4, 9, 80)];
  const result = obvPlugin.create({ signalPeriod: 3 }).reset(bars);
  assert.deepEqual(result.obv.map(x => x.value), [0, 200, 150, 150]);
  assert.deepEqual(result.signal.map(x => x.value), [116.666667, 166.666667]);
});

test('MACD is an own-pane multi-output plugin and append/replace remain incremental-parity safe', () => {
  assert.ok(macdPlugin.outputs.every(x => x.pane === 'own'));
  assert.deepEqual(
    macdPlugin.outputs.map(x => x.id),
    ['macd', 'signal', 'histogram', 'zero'],
  );
  assertIncrementalParity(macdPlugin, { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });
});

test('SuperTrend is a main-pane overlay and append/replace remain incremental-parity safe', () => {
  assert.ok(superTrendPlugin.outputs.every(x => x.pane === 'main'));
  assert.deepEqual(superTrendPlugin.outputs.map(x => x.id), ['trend']);
  assertIncrementalParity(superTrendPlugin, { atrPeriod: 14, multiplier: 2 });

  const data = superTrendPlugin.create({ atrPeriod: 14, multiplier: 2 }).reset(sampleBars(40));
  assert.ok(data.trend.length > 0);
  assert.ok(data.trend.every(x => x.color === '#e34a4a' || x.color === '#3f7fd6'));
});

test('DMI exposes +DI/-DI/ADX strength and remains incremental-parity safe', () => {
  assert.ok(dmiPlugin.outputs.every(x => x.pane === 'own'));
  assert.deepEqual(dmiPlugin.outputs.map(x => x.id), ['plusDi', 'minusDi', 'adx', 'strength']);
  assertIncrementalParity(dmiPlugin, { period: 14, strengthLevel: 20 });

  const rising: ChartBar[] = Array.from({ length: 40 }, (_, i) => ({
    time: i + 1,
    open: 100 + i,
    high: 103 + i,
    low: 99 + i,
    close: 102 + i,
    volume: 1000 + i * 10,
  }));
  const result = dmiPlugin.create({ period: 14, strengthLevel: 20 }).reset(rising);
  const plus = result.plusDi[result.plusDi.length - 1]?.value ?? 0;
  const minus = result.minusDi[result.minusDi.length - 1]?.value ?? 0;
  const adx = result.adx[result.adx.length - 1]?.value ?? 0;
  assert.ok(plus > minus);
  assert.ok(adx > 0);
});

test('all indicator plugins honor real-time append/replace incremental parity', () => {
  const cases: Array<[IndicatorPlugin, IndicatorParams]> = [
    [smaPlugin, { period: 20, source: 'close' }],
    [rsiPlugin, { period: 14, signalPeriod: 7, upper: 70, lower: 30 }],
    [obvPlugin, { signalPeriod: 20 }],
    [macdPlugin, { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }],
    [superTrendPlugin, { atrPeriod: 14, multiplier: 2 }],
    [dmiPlugin, { period: 14, strengthLevel: 20 }],
  ];

  for (const [plugin, params] of cases) assertIncrementalParity(plugin, params);
});

test('IndicatorHost uses setData only for reset and update for live changes', async () => {
  const host = await readFile(new URL('../addons/chart-indicators/IndicatorHost.ts', import.meta.url), 'utf8');

  assert.equal(host.includes('runtime.calculator.update(bars, change)'), true);
  assert.equal(host.includes('runtime.series.get(output.id)?.update(point)'), true);
  assert.equal(host.includes('runtime.series.get(output.id)?.setData(data[output.id] ?? [])'), true);
});

test('indicator JSON schema persists pane order and height with v1 migration boundary', async () => {
  const types = await readFile(new URL('../addons/chart-indicators/types.ts', import.meta.url), 'utf8');
  const host = await readFile(new URL('../addons/chart-indicators/IndicatorHost.ts', import.meta.url), 'utf8');

  assert.equal(types.includes('schemaVersion: 2'), true);
  assert.equal(types.includes('paneHeight?: number'), true);
  assert.equal(types.includes('order?: number'), true);
  assert.equal(host.includes('kiwoom-desk.chart.indicators.v2'), true);
  assert.equal(host.includes('kiwoom-desk.chart.indicators.v1'), true);
  assert.equal(host.includes('getHeight'), true);
  assert.equal(host.includes('setHeight'), true);
  assert.equal(host.includes('data-action="move-up"'), true);
  assert.equal(host.includes('data-action="move-down"'), true);
});

test('ChartForm keeps indicator names and calculations out of the base chart', async () => {
  const source = await readFile(new URL('../src/forms/ChartForm.ts', import.meta.url), 'utf8');

  assert.equal(source.includes('ma5'), false);
  assert.equal(source.includes('ma20'), false);
  assert.equal(source.includes('ma60'), false);
  assert.equal(source.includes('smaPoint'), false);
  assert.equal(source.includes('단순 이동평균'), false);
  assert.equal(source.includes('SuperTrend'), false);
  assert.equal(source.includes('DMI'), false);
  assert.equal(source.includes('createChartExtensions'), true);
});

test('indicator addon is enabled by one removable dynamic import', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const matches = source.match(/addons\/chart-indicators\/register/g) ?? [];

  assert.equal(matches.length, 1);
});

test('base TypeScript roots do not include the removable addon folder', async () => {
  const source = await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8');
  const tsconfig = JSON.parse(source) as { include?: string[] };
  const roots = tsconfig.include ?? [];

  assert.equal(roots.includes('src'), true);
  assert.equal(roots.includes('server'), true);
  assert.equal(roots.some(x => x.startsWith('addons')), false);
});
