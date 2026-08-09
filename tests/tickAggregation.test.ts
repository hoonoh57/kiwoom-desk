import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateSyntheticTickBars,
  reconcileTickProgress,
  type OhlcvBar,
} from '../src/chart/tickAggregation';

function oneTick(i: number): OhlcvBar {
  const price = 100 + i;
  return {
    time: 1_000 + i,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: i + 1,
  };
}

function aggregate(ticks: OhlcvBar[]): OhlcvBar {
  return {
    time: ticks[ticks.length - 1].time,
    open: ticks[0].open,
    high: Math.max(...ticks.map(x => x.high)),
    low: Math.min(...ticks.map(x => x.low)),
    close: ticks[ticks.length - 1].close,
    volume: ticks.reduce((sum, x) => sum + x.volume, 0),
  };
}

test('reconcileTickProgress finds partial current bar and returns later catch-up ticks', () => {
  const ticks = Array.from({ length: 13 }, (_, i) => oneTick(i));
  const target = aggregate(ticks.slice(0, 7));

  const match = reconcileTickProgress(ticks, target, 10);

  assert.ok(match);
  assert.equal(match.progress, 7);
  assert.equal(match.catchup.length, 6);
  assert.deepEqual(match.catchup, ticks.slice(7));
});

test('reconcileTickProgress reports zero progress for a completed bar', () => {
  const ticks = Array.from({ length: 13 }, (_, i) => oneTick(i));
  const target = aggregate(ticks.slice(0, 10));

  const match = reconcileTickProgress(ticks, target, 10);

  assert.ok(match);
  assert.equal(match.progress, 0);
  assert.equal(match.catchup.length, 3);
});

test('240 tick aggregation uses eight 30-tick bars per completed synthetic bar', () => {
  const source = Array.from({ length: 17 }, (_, i): OhlcvBar => ({
    time: Date.UTC(2026, 7, 9, 0, 0, i) / 1000,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 30,
  }));

  const result = aggregateSyntheticTickBars(source, 240);

  assert.equal(result.length, 3);
  assert.equal(result[result.length - 1].volume, 240);
  assert.equal(result[result.length - 1].open, source[9].open);
  assert.equal(result[result.length - 1].close, source[16].close);
});

test('synthetic tick aggregation never crosses a trading-day boundary', () => {
  const day1 = Array.from({ length: 4 }, (_, i): OhlcvBar => ({
    time: Date.UTC(2026, 7, 8, 6, 0, i) / 1000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 30,
  }));
  const day2 = Array.from({ length: 4 }, (_, i): OhlcvBar => ({
    time: Date.UTC(2026, 7, 9, 6, 0, i) / 1000,
    open: 200,
    high: 201,
    low: 199,
    close: 200,
    volume: 30,
  }));

  const result = aggregateSyntheticTickBars([...day1, ...day2], 240);

  assert.equal(result.length, 2);
  assert.equal(result[0].volume, 120);
  assert.equal(result[1].volume, 120);
  assert.equal(result[0].close, 100);
  assert.equal(result[1].close, 200);
});
