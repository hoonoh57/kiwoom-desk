import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createChartRuntimeHost,
  registerChartPlugin,
  resetChartRuntimePluginsForTests,
} from '../src/chart/runtimeHost';

function surface() {
  return {
    chart: { id: 'chart' },
    lc: { id: 'lc' },
    toolbar: {} as HTMLElement,
    primarySeries: { id: 'price' },
    firstAddonPane: 2,
  };
}

test('native visual registry hides and restores optional visuals without feature semantics', () => {
  resetChartRuntimePluginsForTests();
  const visibility: boolean[] = [];

  registerChartPlugin('probe', runtime => {
    const registration = runtime.visuals.register('probe', {
      setVisible: visible => visibility.push(visible),
    });
    return { dispose: () => registration.dispose() };
  });

  const host = createChartRuntimeHost({
    getSymbol: () => '005930',
    reportError: message => assert.fail(message),
  });

  assert.equal(host.areAddonVisualsVisible(), true);
  assert.deepEqual(visibility, [true]);

  host.setAddonVisualsVisible(false);
  assert.equal(host.areAddonVisualsVisible(), false);
  assert.deepEqual(visibility, [true, false]);

  host.setAddonVisualsVisible(false);
  assert.deepEqual(visibility, [true, false]);

  host.setAddonVisualsVisible(true);
  assert.equal(host.areAddonVisualsVisible(), true);
  assert.deepEqual(visibility, [true, false, true]);

  host.dispose();
});

test('core-only runtime remains valid while optional visuals are globally off', () => {
  resetChartRuntimePluginsForTests();
  const errors: string[] = [];
  const host = createChartRuntimeHost({
    getSymbol: () => '005930',
    reportError: message => errors.push(message),
  });

  host.setAddonVisualsVisible(false);
  host.attachSurface(surface());
  host.barsReset([]);
  host.barChanged(
    { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    'append',
    [],
  );
  host.dispose();

  assert.deepEqual(errors, []);
});

test('indicator addon owns native registration instead of legacy extension compatibility', async () => {
  const source = await readFile(
    new URL('../addons/chart-indicators/register.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes("registerChartPlugin('indicators'"), true);
  assert.equal(source.includes("runtime.visuals.register('indicators'"), true);
  assert.equal(source.includes('registerChartExtension'), false);
  assert.equal(source.includes('runtime.series.set'), false);
  assert.equal(source.includes('chart.addSeries'), false);
});

test('indicator implementation semantics remain inside IndicatorHost during ownership migration', async () => {
  const source = await readFile(
    new URL('../addons/chart-indicators/IndicatorHost.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('runtime.calculator.update(bars, change)'), true);
  assert.equal(source.includes('this.context.chart.addSeries'), true);
  assert.equal(source.includes('this.context.chart.removeSeries'), true);
  assert.equal(source.includes('setAddonVisualsVisible'), false);
  assert.equal(source.includes('ChartRuntimeVisual'), false);
});

test('strategy addon does not import indicator addon implementation', async () => {
  const source = await readFile(
    new URL('../addons/chart-strategies/plugins/vwapJmaReclaim.ts', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('chart-indicators'), false);
  assert.equal(source.includes('chart-analysis/vwapJma'), true);
});

test('JMA and VWAP indicator wrappers consume the same shared analysis kernels as strategies', async () => {
  const jma = await readFile(
    new URL('../addons/chart-indicators/plugins/jma.ts', import.meta.url),
    'utf8',
  );
  const vwap = await readFile(
    new URL('../addons/chart-indicators/plugins/vwap.ts', import.meta.url),
    'utf8',
  );
  assert.equal(jma.includes('createJmaAnalysis'), true);
  assert.equal(vwap.includes('createVwapAnalysis'), true);
});
