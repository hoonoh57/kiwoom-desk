import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vwapJma from '../addons/chart-strategies/plugins/vwapJmaReclaim';
import jmaPlugin from '../addons/chart-indicators/plugins/jma';
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
  exitMode: 'vwap-close',
};

function vwapByTime(sample: ChartBar[]): Map<string, number> {
  const data = vwapPlugin.create({
    stdDev1: 1,
    stdDev2: 2,
    showValue: true,
    showUpper1: false,
    showLower1: false,
    showUpper2: false,
    showLower2: false,
  }).reset(sample);
  return new Map((data.value ?? []).map(row => [String(row.time), Number(row.value)]));
}

function jmaByTime(sample: ChartBar[]): Map<string, number> {
  const data = jmaPlugin.create({ period: 3, phase: 50, power: 2 }).reset(sample);
  return new Map((data.value ?? []).map(row => [String(row.time), Number(row.value)]));
}

test('VWAP-JMA v3 emits ARM and BUY on a deterministic rebound without FAIL', () => {
  const result = vwapJma.create(params).reset(bars());
  assert.ok(result.signals.some(x => x.type === 'arm'));
  assert.ok(result.signals.some(x => x.type === 'buy'));
  assert.equal(result.signals.some(x => x.type === 'fail'), false);
});

test('every VWAP-JMA ARM is on an actual VWAP downward cross', () => {
  const sample = bars();
  const result = vwapJma.create(params).reset(sample);
  const arms = result.signals.filter(x => x.type === 'arm');
  assert.ok(arms.length > 0);
  const vw = vwapByTime(sample);

  for (const arm of arms) {
    const index = sample.findIndex(row => String(row.time) === String(arm.time));
    assert.ok(index > 0, 'ARM must have a previous bar');
    const previousVwap = vw.get(String(sample[index - 1].time));
    const currentVwap = vw.get(String(sample[index].time));
    assert.ok(previousVwap !== undefined && currentVwap !== undefined);
    assert.ok(sample[index - 1].close >= previousVwap, 'previous close must be at/above previous VWAP');
    assert.ok(sample[index].close < currentVwap, 'ARM close must freshly break below current VWAP');
  }
});

test('every VWAP-JMA BUY is the VWAP upward recross while JMA is rising', () => {
  const sample = bars();
  const result = vwapJma.create(params).reset(sample);
  const buys = result.signals.filter(x => x.type === 'buy');
  assert.ok(buys.length > 0);
  const vw = vwapByTime(sample);
  const jm = jmaByTime(sample);

  for (const buy of buys) {
    const index = sample.findIndex(row => String(row.time) === String(buy.time));
    assert.ok(index > 0, 'BUY must have a previous bar');
    const previousVwap = vw.get(String(sample[index - 1].time));
    const currentVwap = vw.get(String(sample[index].time));
    const previousJma = jm.get(String(sample[index - 1].time));
    const currentJma = jm.get(String(sample[index].time));
    assert.ok(previousVwap !== undefined && currentVwap !== undefined);
    assert.ok(previousJma !== undefined && currentJma !== undefined);
    assert.ok(sample[index - 1].close <= previousVwap, 'previous close must be at/below previous VWAP');
    assert.ok(sample[index].close > currentVwap, 'BUY close must freshly reclaim current VWAP');
    assert.ok(currentJma > previousJma, 'JMA must be rising on the BUY bar');
  }
});

test('VWAP-JMA v3 removes delayed-entry filters from old saved strategy params', () => {
  assert.equal(vwapJma.version, 3);
  assert.deepEqual(
    vwapJma.parameters.map(x => x.key),
    ['jmaPeriod', 'jmaPhase', 'jmaPower', 'exitMode'],
  );

  const migrated = vwapJma.migrateParams?.({
    jmaPeriod: 14,
    jmaPhase: 50,
    jmaPower: 2,
    requireJmaAboveVwap: true,
    maxEntrySigma: 0.5,
    armExpiryBars: 4,
    exitMode: 'vwap-close',
  }, 2);

  assert.deepEqual(migrated, {
    jmaPeriod: 14,
    jmaPhase: 50,
    jmaPower: 2,
    exitMode: 'vwap-close',
  });
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
