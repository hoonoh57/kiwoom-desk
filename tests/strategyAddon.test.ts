import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vwapJma from '../addons/chart-strategies/plugins/vwapJmaReclaim';
import vwapPlugin from '../addons/chart-indicators/plugins/vwap';
import type { ChartBar } from '../src/chart/extensions';

function bars(): ChartBar[] {
  const closes: number[] = [];
  for (let i = 0; i < 15; i++) closes.push(100 + Math.sin(i / 2) * 0.4);
  for (let i = 0; i < 8; i++) closes.push(99 - i * 1.2);
  for (let i = 0; i < 20; i++) closes.push(91 + i * 1.4);
  return closes.map((close, i) => ({
    time: 1_700_000_000 + i * 60,
    tradingDate: '2026-08-10',
    open: close - 0.3,
    high: close + 0.7,
    low: close - 0.8,
    close,
    volume: 1000 + i * 20,
  }));
}

const params = {
  jmaPeriod: 3,
  jmaPhase: 50,
  jmaPower: 2,
  requireJmaAboveVwap: false,
  maxEntrySigma: 10,
  armExpiryBars: 30,
  exitMode: 'vwap-close',
};

test('VWAP-JMA reclaim emits ARM and BUY on a deterministic rebound', () => {
  const result = vwapJma.create(params).reset(bars());
  assert.ok(result.signals.some(x => x.type === 'arm'));
  assert.ok(result.signals.some(x => x.type === 'buy'));
});

test('every VWAP-JMA BUY is on the actual VWAP upward recross bar', () => {
  const sample = bars();
  const result = vwapJma.create(params).reset(sample);
  const buys = result.signals.filter(x => x.type === 'buy');
  assert.ok(buys.length > 0);

  const vwap = vwapPlugin.create({
    stdDev1: 1,
    stdDev2: 2,
    showValue: true,
    showUpper1: false,
    showLower1: false,
    showUpper2: false,
    showLower2: false,
  }).reset(sample);
  const byTime = new Map((vwap.value ?? []).map(row => [String(row.time), Number(row.value)]));

  for (const buy of buys) {
    const index = sample.findIndex(row => String(row.time) === String(buy.time));
    assert.ok(index > 0, 'BUY must have a previous bar');
    const previousVwap = byTime.get(String(sample[index - 1].time));
    const currentVwap = byTime.get(String(sample[index].time));
    assert.ok(previousVwap !== undefined && currentVwap !== undefined);
    assert.ok(sample[index - 1].close <= previousVwap, 'previous close must be at/below previous VWAP');
    assert.ok(sample[index].close > currentVwap, 'BUY close must freshly reclaim current VWAP');
  }
});

test('VWAP-JMA v2 defaults to prompt reclaim and migrates v1 strict confirmation off', () => {
  assert.equal(vwapJma.version, 2);
  assert.equal(
    vwapJma.parameters.find(x => x.key === 'requireJmaAboveVwap')?.default,
    false,
  );
  const migrated = vwapJma.migrateParams?.({ requireJmaAboveVwap: true, jmaPeriod: 14 }, 1);
  assert.equal(migrated?.requireJmaAboveVwap, false);
  assert.equal(migrated?.jmaPeriod, 14);
});

test('VWAP-JMA strategy append and replace match a fresh full calculation', () => {
  const sample = bars();
  const live = vwapJma.create(params);
  live.reset(sample);

  sample.push({
    time: 1_700_000_000 + sample.length * 60,
    tradingDate: '2026-08-10',
    open: 118,
    high: 120,
    low: 117,
    close: 119,
    volume: 2600,
  });
  const appended = live.update(sample, 'append');
  const freshAppend = vwapJma.create(params).reset(sample);
  assert.deepEqual(appended.signals, freshAppend.signals);

  sample[sample.length - 1] = {
    ...sample[sample.length - 1],
    open: 94,
    high: 95,
    low: 90,
    close: 91,
    volume: 3200,
  };
  const replaced = live.update(sample, 'replace');
  const freshReplace = vwapJma.create(params).reset(sample);
  assert.deepEqual(replaced.signals, freshReplace.signals);
});

test('base ChartForm remains strategy-name and execution agnostic', () => {
  const root = path.resolve(process.cwd());
  const source = fs.readFileSync(path.join(root, 'src/forms/ChartForm.ts'), 'utf8');
  assert.equal(source.includes('VWAP-JMA Reclaim'), false);
  assert.equal(source.includes('StrategyTradeIntent'), false);
  assert.equal(source.includes('StrategyHost'), false);
});

test('strategy addon has one removable registration point and broker safety gate', () => {
  const root = path.resolve(process.cwd());
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8');
  const register = fs.readFileSync(path.join(root, 'addons/chart-strategies/register.ts'), 'utf8');
  const execution = fs.readFileSync(path.join(root, 'addons/chart-strategies/execution.ts'), 'utf8');
  const account = fs.readFileSync(path.join(root, 'src/forms/AccountForm.ts'), 'utf8');
  const catalog = fs.readFileSync(path.join(root, 'addons/chart-strategies/catalog.ts'), 'utf8');

  assert.match(main, /addons\/chart-strategies\/register/);
  assert.match(register, /registerChartExtension\('strategies'/);
  assert.match(execution, /payload\?\.confirmed === true/);
  assert.match(execution, /kt10000/);
  assert.match(execution, /kt10001/);
  assert.match(execution, /ka10076/);
  assert.match(account, /StrategyPortfolioChanged/);
  assert.match(catalog, /migrateParams/);
});
