import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
// Verification probe v2: rerun recovered main after the PowerShell gate fix.
import {
  ChartRuntimeServiceIds,
  createChartRuntimeHost,
  registerChartPlugin,
  resetChartRuntimePluginsForTests,
} from '../src/chart/runtimeHost';
import {
  createChartExtensions,
  registerChartExtension,
  type ChartExtensionContext,
} from '../src/chart/extensions';

function shell() {
  return {
    root: {} as HTMLElement,
    canvas: {} as HTMLElement,
    toolbar: {} as HTMLElement,
  };
}

function surface() {
  return {
    chart: { id: 'chart' },
    lc: { id: 'lc' },
    toolbar: {} as HTMLElement,
    primarySeries: { id: 'price' },
    firstAddonPane: 2,
  };
}

test('chart runtime host is valid with zero optional plugins', () => {
  resetChartRuntimePluginsForTests();
  const errors: string[] = [];
  const host = createChartRuntimeHost({
    getSymbol: () => '005930',
    reportError: message => errors.push(message),
  });

  host.shellReady(shell());
  host.attachSurface(surface());
  host.beforeBarsReset([]);
  host.barsReset([]);
  host.detachSurface();
  host.dispose();

  assert.deepEqual(errors, []);
});

test('one plugin seam receives deterministic shell surface and bar lifecycle', () => {
  resetChartRuntimePluginsForTests();
  const calls: string[] = [];
  registerChartPlugin('probe', context => ({
    onShellReady: () => calls.push(`shell:${context.getSymbol()}`),
    onChartReady: current => calls.push(`chart:${current.firstAddonPane}`),
    onBeforeBarsReset: bars => calls.push(`before:${bars.length}`),
    onBarsReset: bars => calls.push(`reset:${bars.length}`),
    onBarChanged: (_bar, change, bars) => calls.push(`${change}:${bars.length}`),
    onChartDetached: () => calls.push('chart-detached'),
    onShellDetached: () => calls.push('shell-detached'),
    dispose: () => calls.push('dispose'),
  }));

  const host = createChartRuntimeHost({
    getSymbol: () => '005930',
    reportError: message => assert.fail(message),
  });
  const bars = [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
  host.shellReady(shell());
  host.attachSurface(surface());
  host.beforeBarsReset(bars);
  host.barsReset(bars);
  host.barChanged(bars[0], 'replace', bars);
  host.dispose();

  assert.deepEqual(calls, [
    'shell:005930',
    'chart:2',
    'before:1',
    'reset:1',
    'replace:1',
    'chart-detached',
    'shell-detached',
    'dispose',
  ]);
});

test('runtime services are centralized and cannot be silently overwritten', () => {
  resetChartRuntimePluginsForTests();
  const seen: unknown[] = [];
  registerChartPlugin('services', context => {
    seen.push(context.services.get(ChartRuntimeServiceIds.APP_API));
    const registration = context.services.provide('probe.service', { ok: true });
    assert.deepEqual(context.services.get('probe.service'), { ok: true });
    assert.throws(
      () => context.services.provide('probe.service', { ok: false }),
      /already provided/,
    );
    return { dispose: () => registration.dispose() };
  });

  const api = { call: () => undefined };
  const host = createChartRuntimeHost({
    getSymbol: () => '005930',
    initialServices: { [ChartRuntimeServiceIds.APP_API]: api },
    reportError: message => assert.fail(message),
  });
  host.dispose();
  assert.equal(seen[0], api);
});

test('plugin failure is isolated and base host continues dispatching healthy plugins', () => {
  resetChartRuntimePluginsForTests();
  const calls: string[] = [];
  const errors: string[] = [];
  registerChartPlugin('bad', () => ({
    onBarsReset: () => { throw new Error('boom'); },
    dispose: () => calls.push('bad-dispose'),
  }));
  registerChartPlugin('good', () => ({
    onBarsReset: () => calls.push('good-reset'),
    onBarChanged: () => calls.push('good-change'),
  }));

  const host = createChartRuntimeHost({
    getSymbol: () => '005930',
    reportError: message => errors.push(message),
  });
  host.barsReset([]);
  host.barChanged({ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }, 'append', []);
  host.dispose();

  assert.deepEqual(calls, ['bad-dispose', 'good-reset', 'good-change']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /bad.*비활성화.*boom/);
});

test('legacy registerChartExtension is only a compatibility adapter over the same host', () => {
  resetChartRuntimePluginsForTests();
  const calls: string[] = [];
  registerChartExtension('legacy', (context: ChartExtensionContext) => {
    calls.push(`created:${context.firstAddonPane}`);
    return {
      onBarsReset: bars => calls.push(`reset:${bars.length}`),
      onBarChanged: (_bar, change) => calls.push(change),
      dispose: () => calls.push('legacy-dispose'),
    };
  });

  const legacy = createChartExtensions({
    chart: { id: 'chart' },
    lc: { id: 'lc' },
    toolbar: {} as HTMLElement,
    primarySeries: { id: 'price' },
    firstAddonPane: 2,
    reportError: message => assert.fail(message),
  });
  legacy.onBarsReset([]);
  legacy.onBarChanged({ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }, 'append', []);
  legacy.dispose();

  assert.deepEqual(calls, ['created:2', 'reset:0', 'append', 'legacy-dispose']);
});

test('ChartForm uses one native runtime host seam and contains no optional feature implementation', async () => {
  const source = await fs.readFile(new URL('../src/forms/ChartForm.ts', import.meta.url), 'utf8');

  assert.equal(source.includes('CHART_RUNTIME_HOST_NATIVE_V1'), true);
  assert.equal(source.includes('createChartRuntimeHost'), true);
  assert.equal(source.includes('createChartExtensions'), false);
  assert.equal(source.includes('ChartExtensionGroup'), false);

  for (const forbidden of [
    'SuperTrend',
    'DMI',
    '단순 이동평균',
    'ThemeContext',
    'ResearchFeature',
    'PropertyGrid',
    'SOX-N15-V1',
  ]) {
    assert.equal(source.includes(forbidden), false, `ChartForm contains optional feature implementation: ${forbidden}`);
  }

  for (const lifecycle of [
    'runtimeHost?.shellReady',
    'runtimeHost?.attachSurface',
    'runtimeHost?.beforeBarsReset',
    'runtimeHost?.barsReset',
    'runtimeHost?.barChanged',
    'runtimeHost?.detachSurface',
    'runtimeHost?.dispose',
  ]) {
    assert.equal(source.includes(lifecycle), true, `ChartForm missing native Host lifecycle: ${lifecycle}`);
  }
});

test('chart.viewport is a permanent generic Host contract with no optional-feature ownership', async () => {
  assert.equal(ChartRuntimeServiceIds.CHART_VIEWPORT, 'chart.viewport');

  const viewport = await fs.readFile(new URL('../src/chart/runtimeViewport.ts', import.meta.url), 'utf8');
  assert.match(viewport, /export interface ChartRuntimeViewportState/);
  assert.match(viewport, /logicalRange\?: ChartRuntimeLogicalRange/);
  assert.match(viewport, /visibleTimeRange\?: ChartRuntimeVisibleTimeRange/);
  assert.match(viewport, /viewportBarCount\?: number/);
  assert.match(viewport, /followLatest\?: boolean/);
  assert.match(viewport, /export interface ChartRuntimeViewportService/);
  assert.match(viewport, /read\(\): ChartRuntimeViewportState \| undefined/);
  assert.match(viewport, /apply\(state: ChartRuntimeViewportState\): void/);
  assert.match(viewport, /beginLayoutMutation\(reason\?: string\): \(\) => void/);
  assert.match(viewport, /flush\(\): void/);

  for (const forbidden of [
    'WorkspaceSession',
    'VirtualDesktop',
    'ThemeContext',
    'ResearchFeature',
    'PropertyGrid',
    'SOX-N15-V1',
    'SuperTrend',
  ]) {
    assert.equal(
      viewport.includes(forbidden),
      false,
      `Generic viewport contract contains optional feature ownership: ${forbidden}`,
    );
  }
});
