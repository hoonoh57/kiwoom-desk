import test from 'node:test';
import assert from 'node:assert/strict';
import emaPlugin from '../addons/chart-indicators/plugins/ema';
import bollingerPlugin from '../addons/chart-indicators/plugins/bollinger';
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
    const close = 100 + i * 1.3 + Math.sin(i / 4) * 5;
    return {
      time: i + 1,
      open: close - Math.sin(i) * 1.2,
      high: close + 2 + Math.abs(Math.sin(i)) * 2,
      low: close - 2 - Math.abs(Math.cos(i)) * 2,
      close,
      volume: 1000 + i * 31,
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
    open: 151,
    high: 158,
    low: 149,
    close: 156.25,
    volume: 3200,
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
    time: 41,
    open: 151,
    high: 154,
    low: 143,
    close: 145.5,
    volume: 3700,
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

test('EMA is a main-pane overlay with deterministic SMA seeding', () => {
  assert.ok(emaPlugin.outputs.every(x => x.pane === 'main'));
  assert.deepEqual(emaPlugin.outputs.map(x => x.id), ['value']);

  const bars = [bar(1, 10), bar(2, 20), bar(3, 30), bar(4, 40)];
  const result = emaPlugin.create({ period: 3, source: 'close' }).reset(bars);
  assert.deepEqual(result.value, [
    { time: 3, value: 20 },
    { time: 4, value: 30 },
  ]);

  assertIncrementalParity(emaPlugin, { period: 20, source: 'close' });
});

test('Bollinger Bands expose basis/upper/lower on the main pane', () => {
  assert.ok(bollingerPlugin.outputs.every(x => x.pane === 'main'));
  assert.deepEqual(bollingerPlugin.outputs.map(x => x.id), ['basis', 'upper', 'lower']);

  const bars = [bar(1, 10), bar(2, 20), bar(3, 30)];
  const result = bollingerPlugin.create({ period: 3, multiplier: 2, source: 'close' }).reset(bars);
  assert.equal(result.basis[0]?.value, 20);
  assert.equal(result.upper[0]?.value, 36.329932);
  assert.equal(result.lower[0]?.value, 3.670068);

  assertIncrementalParity(bollingerPlugin, { period: 20, multiplier: 2, source: 'close' });
});

test('EMA and Bollinger allow independent source and parameter configuration', () => {
  const emaParams = Object.fromEntries(emaPlugin.parameters.map(x => [x.key, x.default]));
  const bbParams = Object.fromEntries(bollingerPlugin.parameters.map(x => [x.key, x.default]));

  assert.deepEqual(emaParams, { period: 20, source: 'close' });
  assert.deepEqual(bbParams, { period: 20, multiplier: 2, source: 'close' });
});
