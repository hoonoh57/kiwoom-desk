import test from 'node:test';
import assert from 'node:assert/strict';
import disparityPlugin from '../addons/chart-indicators/plugins/disparity';
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
    const close = 100 + Math.sin(i / 4) * 10 + Math.sin(i / 13) * 4 + i * 0.05;
    return {
      time: i + 1,
      open: close - Math.sin(i) * 1.5,
      high: close + 2 + Math.abs(Math.sin(i)),
      low: close - 2 - Math.abs(Math.cos(i)),
      close,
      volume: 1500 + i * 23,
    };
  });
}

function last<T>(rows: readonly T[]): T | null {
  return rows.length ? rows[rows.length - 1] : null;
}

test('Disparity keeps the ChartKit 20/105/100/95 own-pane contract', () => {
  const params = Object.fromEntries(disparityPlugin.parameters.map(x => [x.key, x.default]));
  assert.deepEqual(params, { period: 20, upper: 105, baseline: 100, lower: 95 });
  assert.deepEqual(disparityPlugin.outputs.map(x => x.id), ['value', 'upper', 'baseline', 'lower']);
  assert.ok(disparityPlugin.outputs.every(x => x.pane === 'own'));
});

test('Disparity matches the ChartKit float32 SMA ratio contract', () => {
  const bars = [bar(1, 10), bar(2, 20), bar(3, 30), bar(4, 40)];
  const result = disparityPlugin.create({ period: 3, upper: 105, baseline: 100, lower: 95 }).reset(bars);

  assert.deepEqual(result.value, [
    { time: 3, value: 150 },
    { time: 4, value: 133.33334350585938 },
  ]);
  assert.deepEqual(result.upper, [{ time: 1, value: 105 }, { time: 4, value: 105 }]);
  assert.deepEqual(result.baseline, [{ time: 1, value: 100 }, { time: 4, value: 100 }]);
  assert.deepEqual(result.lower, [{ time: 1, value: 95 }, { time: 4, value: 95 }]);
});

test('Disparity emits 100 when the full moving average is non-positive', () => {
  const bars = [bar(1, 0), bar(2, 0), bar(3, 0)];
  const result = disparityPlugin.create({ period: 3, upper: 105, baseline: 100, lower: 95 }).reset(bars);
  assert.deepEqual(result.value, [{ time: 3, value: 100 }]);
});

test('Disparity append and replace equal a fresh full calculation at the last point', () => {
  const params = { period: 20, upper: 105, baseline: 100, lower: 95 };
  const bars = sampleBars(60);
  const calc = disparityPlugin.create(params);
  calc.reset(bars);

  bars.push({
    time: 61,
    open: 112,
    high: 119,
    low: 108,
    close: 117.25,
    volume: 4500,
  });
  const appended = calc.update(bars, 'append');
  const fullAppend = disparityPlugin.create(params).reset(bars);
  assert.deepEqual(appended.value, last(fullAppend.value));

  bars[bars.length - 1] = {
    time: 61,
    open: 112,
    high: 114,
    low: 101,
    close: 104.75,
    volume: 4900,
  };
  const replaced = calc.update(bars, 'replace');
  const fullReplace = disparityPlugin.create(params).reset(bars);
  assert.deepEqual(replaced.value, last(fullReplace.value));
});

test('Disparity preserves the ChartKit Close-only source contract', () => {
  const source = sampleBars(50);
  const distorted = source.map((x, i) => ({
    ...x,
    open: x.open + 1000 + i,
    high: x.high + 2000 + i,
    low: x.low - 2000 - i,
    volume: x.volume * 77,
  }));
  const params = { period: 20, upper: 110, baseline: 100, lower: 90 };

  assert.deepEqual(
    disparityPlugin.create(params).reset(source).value,
    disparityPlugin.create(params).reset(distorted).value,
  );
});
