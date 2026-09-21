import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ChartWorkspaceForm stores chart child state opaquely and reuses it on child recreation', async () => {
  const source = await readFile(
    new URL('../src/forms/ChartWorkspaceForm.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('private chartState: unknown;'), true);
  assert.equal(source.includes('chartState: this.chartState === undefined'), true);
  assert.equal(source.includes('onChartStateChange: (state: unknown) =>'), true);
  assert.equal(source.includes('this.chartState = snapshot;'), true);
  assert.equal(source.includes('this.params.chartState = snapshot;'), true);
  assert.equal(source.includes('forwardState?.('), true);

  // Parent/workspace must never interpret the child chart envelope.
  assert.equal(source.includes('chartState.core'), false);
  assert.equal(source.includes('chartState.addons'), false);
  assert.equal(source.includes('chartState.indicators'), false);
  assert.equal(source.includes('chartState.strategy'), false);
});
