import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import smaPlugin from '../src/chart-addons/indicators/plugins/sma';
import type { ChartBar } from '../src/chart/extensions';

function bar(time: number, close: number): ChartBar {
  return {
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  };
}

test('SMA plugin preserves the former MA5/20/60 defaults', () => {
  const periods = (smaPlugin.defaultInstances ?? [])
    .map(x => Number(x.params?.period))
    .sort((a, b) => a - b);

  assert.deepEqual(periods, [5, 20, 60]);
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

test('ChartForm keeps indicator names and calculations out of the base chart', async () => {
  const source = await readFile(new URL('../src/forms/ChartForm.ts', import.meta.url), 'utf8');

  assert.equal(source.includes('ma5'), false);
  assert.equal(source.includes('ma20'), false);
  assert.equal(source.includes('ma60'), false);
  assert.equal(source.includes('smaPoint'), false);
  assert.equal(source.includes('단순 이동평균'), false);
  assert.equal(source.includes('createChartExtensions'), true);
});

test('indicator addon is enabled by one removable side-effect import', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const matches = source.match(/chart-addons\/indicators\/register/g) ?? [];

  assert.equal(matches.length, 1);
});
