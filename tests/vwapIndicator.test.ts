import test from 'node:test';
import assert from 'node:assert/strict';
import vwapPlugin from '../addons/chart-indicators/plugins/vwap';
import type { ChartBar } from '../src/chart/extensions';

function bar(
  time: number,
  tradingDate: string,
  high: number,
  low: number,
  close: number,
  volume: number,
): ChartBar {
  return {
    time,
    tradingDate,
    open: close,
    high,
    low,
    close,
    volume,
  };
}

function defaults() {
  return Object.fromEntries(vwapPlugin.parameters.map(x => [x.key, x.default]));
}

function last<T>(rows: readonly T[]): T | null {
  return rows.length ? rows[rows.length - 1] : null;
}

test('VWAP preserves ChartKit defaults and keeps bands visually subordinate', () => {
  assert.deepEqual(defaults(), {
    stdDev1: 1,
    stdDev2: 2,
    showValue: true,
    showUpper1: true,
    showLower1: true,
    showUpper2: true,
    showLower2: true,
  });
  assert.ok(vwapPlugin.outputs.every(x => x.pane === 'main'));

  const valueColor = String(vwapPlugin.outputs.find(x => x.id === 'value')?.options?.color ?? '');
  const upper1Color = String(vwapPlugin.outputs.find(x => x.id === 'upper1')?.options?.color ?? '');
  const upper2Color = String(vwapPlugin.outputs.find(x => x.id === 'upper2')?.options?.color ?? '');
  assert.equal(valueColor, '#00E5FF');
  assert.match(upper1Color, /rgba\(.+\.32\)/);
  assert.match(upper2Color, /rgba\(.+\.20\)/);
});

test('VWAP matches weighted typical-price bands and resets on TradingDate change', () => {
  const bars: ChartBar[] = [
    bar(1, '2026-08-07', 12, 8, 10, 100),
    bar(2, '2026-08-07', 24, 16, 20, 100),
    bar(3, '2026-08-10', 33, 27, 30, 100),
  ];
  const out = vwapPlugin.create(defaults()).reset(bars);

  assert.deepEqual(out.value.map(x => x.value), [10, 15, 30]);
  assert.deepEqual(out.upper1.map(x => x.value), [10, 20, 30]);
  assert.deepEqual(out.lower1.map(x => x.value), [10, 10, 30]);
  assert.deepEqual(out.upper2.map(x => x.value), [10, 25, 30]);
  assert.deepEqual(out.lower2.map(x => x.value), [10, 5, 30]);
});

test('VWAP emits no value for zero cumulative volume and resumes inside the same new session', () => {
  const bars: ChartBar[] = [
    bar(1, '2026-08-07', 12, 8, 10, 100),
    bar(2, '2026-08-10', 30, 30, 30, 0),
    bar(3, '2026-08-10', 42, 38, 40, 100),
  ];
  const out = vwapPlugin.create(defaults()).reset(bars);

  assert.deepEqual(out.value.map(x => [x.time, x.value]), [[1, 10], [3, 40]]);
  assert.equal(last(out.upper2)?.value, 40);
  assert.equal(last(out.lower2)?.value, 40);
});

test('VWAP append and replace equal a fresh multi-session full calculation', () => {
  const params = defaults();
  const bars: ChartBar[] = [
    bar(1, '2026-08-07', 102, 98, 100, 1000),
    bar(2, '2026-08-07', 106, 100, 104, 1200),
    bar(3, '2026-08-10', 111, 105, 109, 900),
  ];
  const calc = vwapPlugin.create(params);
  calc.reset(bars);

  bars.push(bar(4, '2026-08-10', 116, 108, 114, 1400));
  const appended = calc.update(bars, 'append');
  const fullAppend = vwapPlugin.create(params).reset(bars);
  for (const output of vwapPlugin.outputs) {
    assert.deepEqual(appended[output.id] ?? null, last(fullAppend[output.id] ?? []));
  }

  bars[bars.length - 1] = bar(4, '2026-08-10', 113, 101, 105, 1800);
  const replaced = calc.update(bars, 'replace');
  const fullReplace = vwapPlugin.create(params).reset(bars);
  for (const output of vwapPlugin.outputs) {
    assert.deepEqual(replaced[output.id] ?? null, last(fullReplace[output.id] ?? []));
  }
});

test('VWAP band lines can be selectively hidden through persisted boolean parameters', () => {
  const bars: ChartBar[] = [
    bar(1, '2026-08-10', 102, 98, 100, 1000),
    bar(2, '2026-08-10', 106, 100, 104, 1200),
  ];
  const out = vwapPlugin.create({
    ...defaults(),
    showUpper1: false,
    showLower1: false,
    showUpper2: false,
    showLower2: false,
  }).reset(bars);

  assert.equal(out.value.length, 2);
  assert.deepEqual(out.upper1, []);
  assert.deepEqual(out.lower1, []);
  assert.deepEqual(out.upper2, []);
  assert.deepEqual(out.lower2, []);
});

test('VWAP can derive the session date from the chart time compatibility path', () => {
  const bars: ChartBar[] = [
    { time: '2026-08-07', open: 10, high: 12, low: 8, close: 10, volume: 100 },
    { time: '2026-08-10', open: 20, high: 22, low: 18, close: 20, volume: 100 },
  ];
  const out = vwapPlugin.create(defaults()).reset(bars);
  assert.deepEqual(out.value.map(x => x.value), [10, 20]);
});
