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

test('runtime host exposes one generic add-on JSON state capability and visual projection follows it', () => {
  resetChartRuntimePluginsForTests();
  const visibility: boolean[] = [];
  let stateSeenByPlugin: unknown;

  registerChartPlugin('opaque-probe', runtime => {
    stateSeenByPlugin = runtime.addonState.read('opaque-instance');
    const registration = runtime.visuals.register('opaque-probe', {
      setVisible: visible => visibility.push(visible),
    });
    return { dispose: () => registration.dispose() };
  });

  const host = createChartRuntimeHost({
    getSymbol: () => '005930',
    initialAddonState: {
      schemaVersion: 1,
      visualsVisible: false,
      addons: {
        'opaque-instance': {
          enabled: true,
          state: {
            child: {
              nested: {
                visible: false,
                value: 7,
              },
            },
          },
        },
      },
    },
    reportError: message => assert.fail(message),
  });

  assert.deepEqual(stateSeenByPlugin, {
    enabled: true,
    state: {
      child: {
        nested: {
          visible: false,
          value: 7,
        },
      },
    },
  });
  assert.equal(host.areAddonVisualsVisible(), false);
  assert.deepEqual(visibility, [false]);

  host.setAddonVisualsVisible(true);
  const snapshot = host.getAddonStateSnapshot();
  assert.equal(snapshot.visualsVisible, true);
  assert.equal(snapshot.addons['opaque-instance']?.enabled, true);
  assert.deepEqual(snapshot.addons['opaque-instance']?.state, {
    child: {
      nested: {
        visible: false,
        value: 7,
      },
    },
  });
  assert.deepEqual(visibility, [false, true]);

  host.dispose();
});

test('master add-on OFF/ON changes only visualsVisible and preserves the complete nested child subtree', () => {
  resetChartRuntimePluginsForTests();
  const visibility: boolean[] = [];

  registerChartPlugin('opaque-probe', runtime => {
    const registration = runtime.visuals.register('opaque-probe', {
      setVisible: visible => visibility.push(visible),
    });
    return { dispose: () => registration.dispose() };
  });

  const host = createChartRuntimeHost({
    getSymbol: () => '005930',
    initialAddonState: {
      schemaVersion: 1,
      visualsVisible: true,
      addons: {
        'opaque-instance': {
          enabled: true,
          state: {
            style: {
              'opaque-output': {
                visible: false,
                lineWidth: 3,
              },
            },
            params: {
              period: 14,
            },
          },
        },
      },
    },
    reportError: message => assert.fail(message),
  });

  const before = host.getAddonStateSnapshot();
  const beforeNode = JSON.stringify(before.addons['opaque-instance']);

  host.setAddonVisualsVisible(false);
  const hidden = host.getAddonStateSnapshot();
  assert.equal(hidden.visualsVisible, false);
  assert.equal(JSON.stringify(hidden.addons['opaque-instance']), beforeNode);

  host.setAddonVisualsVisible(true);
  const restored = host.getAddonStateSnapshot();
  assert.equal(restored.visualsVisible, true);
  assert.equal(JSON.stringify(restored.addons['opaque-instance']), beforeNode);
  assert.deepEqual(visibility, [true, false, true]);

  host.dispose();
});

test('runtime host replaces authoritative add-on document before subscribers re-project state', () => {
  resetChartRuntimePluginsForTests();
  const observed: unknown[] = [];
  const visibility: boolean[] = [];

  registerChartPlugin('opaque-probe', runtime => {
    const unsubscribe = runtime.addonState.subscribe('instance-a', node => {
      observed.push(node?.state);
    });
    const registration = runtime.visuals.register('opaque-probe', {
      setVisible: visible => visibility.push(visible),
    });
    return {
      dispose: () => {
        unsubscribe();
        registration.dispose();
      },
    };
  });

  const host = createChartRuntimeHost({
    getSymbol: () => '005930',
    reportError: message => assert.fail(message),
  });

  host.replaceAddonState({
    schemaVersion: 1,
    visualsVisible: false,
    addons: {
      'instance-a': {
        enabled: true,
        state: {
          layer: {
            childVisible: false,
          },
        },
      },
    },
  });

  assert.deepEqual(observed, [{ layer: { childVisible: false } }]);
  assert.equal(host.getAddonStateSnapshot().visualsVisible, false);
  assert.deepEqual(visibility, [true, false]);

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

  assert.equal(source.includes("const INDICATOR_STATE_ID = 'indicators'"), true);
  assert.equal(source.includes('registerChartPlugin(INDICATOR_STATE_ID'), true);
  assert.equal(source.includes('runtime.visuals.register(INDICATOR_STATE_ID'), true);
  assert.equal(source.includes('addonState: runtime.addonState'), true);
  assert.equal(source.includes('registerChartExtension'), false);
  assert.equal(source.includes('runtime.series.set'), false);
  assert.equal(source.includes('chart.addSeries'), false);
});

test('indicator state authority is runtime addonState; legacy browser storage is migration-input only', async () => {
  const source = await readFile(
    new URL('../addons/chart-indicators/IndicatorHost.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('this.context.addonState.read<IndicatorChartState>'), true);
  assert.equal(source.includes('this.context.addonState.write(this.context.stateId'), true);
  assert.equal(source.includes('addonState.subscribe<IndicatorChartState>'), true);
  assert.equal(source.includes('localStorage.getItem(STORAGE_KEY)'), true);
  assert.equal(source.includes('localStorage.getItem(LEGACY_STORAGE_KEY)'), true);
  assert.equal(source.includes('localStorage.setItem('), false);
  assert.equal(source.includes('window.dispatchEvent(new CustomEvent'), false);
  assert.equal(source.includes('STATE_EVENT'), false);
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
