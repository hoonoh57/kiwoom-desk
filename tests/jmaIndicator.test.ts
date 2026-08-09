import test from 'node:test';
import assert from 'node:assert/strict';
import jmaPlugin from '../addons/chart-indicators/plugins/jma';
import type { ChartBar } from '../src/chart/extensions';

function bar(time: number, close: number): ChartBar {
  return {
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000 + time,
  };
}

function sampleBars(count: number): ChartBar[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + Math.sin(i / 3) * 12 + Math.sin(i / 11) * 5 + i * 0.08;
    return {
      time: i + 1,
      open: close - Math.sin(i) * 2,
      high: close + 3 + Math.abs(Math.sin(i)) * 2,
      low: close - 3 - Math.abs(Math.cos(i)) * 2,
      close,
      volume: 2000 + i * 17,
    };
  });
}

function last<T>(rows: readonly T[]): T | null {
  return rows.length ? rows[rows.length - 1] : null;
}

test('JMA keeps the ChartKit legacy defaults and main-pane contract', () => {
  const params = Object.fromEntries(jmaPlugin.parameters.map(x => [x.key, x.default]));
  assert.deepEqual(params, { period: 14, phase: 50, power: 2 });
  assert.deepEqual(jmaPlugin.outputs.map(x => x.id), ['value']);
  assert.ok(jmaPlugin.outputs.every(x => x.pane === 'main'));
});

test('JMA matches the ChartKit warmup and recursive golden values', () => {
  const bars = [bar(1, 10), bar(2, 20), bar(3, 30), bar(4, 40)];
  const result = jmaPlugin.create({ period: 3, phase: 50, power: 2 }).reset(bars);

  assert.deepEqual(result.value.map(x => x.value), [10, 15, 20, 37.2569]);
  assert.ok(result.value.every(x => x.color === '#AB47BC'));
});

test('JMA direction coloring exercises both ChartKit up/down states', () => {
  const bars = Array.from({ length: 80 }, (_, i) => bar(
    i + 1,
    100 + Math.sin(i / 5) * 30,
  ));
  const result = jmaPlugin.create({ period: 14, phase: 50, power: 2 }).reset(bars);
  const colors = new Set(result.value.map(x => x.color));

  assert.equal(colors.has('#AB47BC'), true);
  assert.equal(colors.has('#00C853'), true);
});

test('JMA append and replace equal a fresh full calculation at the last point', () => {
  const params = { period: 14, phase: 50, power: 2 };
  const bars = sampleBars(60);
  const calc = jmaPlugin.create(params);
  calc.reset(bars);

  bars.push({
    time: 61,
    open: 112,
    high: 119,
    low: 109,
    close: 117.25,
    volume: 4500,
  });
  const append = calc.update(bars, 'append').value;
  const fullAppend = last(jmaPlugin.create(params).reset(bars).value);
  assert.deepEqual(append, fullAppend);

  bars[bars.length - 1] = {
    time: 61,
    open: 112,
    high: 114,
    low: 102,
    close: 104.75,
    volume: 4900,
  };
  const replace = calc.update(bars, 'replace').value;
  const fullReplace = last(jmaPlugin.create(params).reset(bars).value);
  assert.deepEqual(replace, fullReplace);
});

test('JMA preserves the ChartKit Close-only source contract', () => {
  const closes = sampleBars(40);
  const distorted = closes.map((x, i) => ({
    ...x,
    open: x.open + 1000 + i,
    high: x.high + 2000 + i,
    low: x.low - 2000 - i,
    volume: x.volume * 99,
  }));
  const params = { period: 14, phase: -25, power: 3 };

  assert.deepEqual(
    jmaPlugin.create(params).reset(closes).value,
    jmaPlugin.create(params).reset(distorted).value,
  );
});
