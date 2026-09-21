import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  CHART_RUNTIME_ADDON_STATE_SCHEMA_VERSION,
  createChartRuntimeAddonStateStore,
  type ChartRuntimeAddonStateDocument,
} from '../src/chart/runtimeAddonState';

test('add-on state document preserves opaque nested child state without runtime interpretation', () => {
  const initial: ChartRuntimeAddonStateDocument = {
    schemaVersion: CHART_RUNTIME_ADDON_STATE_SCHEMA_VERSION,
    visualsVisible: true,
    addons: {
      'addon-a': {
        enabled: true,
        state: {
          period: 14,
          child: {
            enabled: true,
            visible: false,
            width: 1,
          },
        },
      },
    },
  };

  const store = createChartRuntimeAddonStateStore(initial);
  assert.deepEqual(store.snapshot(), initial);

  store.update<any>('addon-a', current => ({
    enabled: current?.enabled ?? true,
    state: {
      ...current?.state,
      child: {
        ...current?.state?.child,
        visible: true,
      },
    },
  }));

  assert.equal((store.read<any>('addon-a')?.state as any).child.visible, true);
  assert.equal((store.read<any>('addon-a')?.state as any).period, 14);
});

test('mutation commits JSON state before subscribers render the change', () => {
  const store = createChartRuntimeAddonStateStore();
  const observed: unknown[] = [];

  const release = store.subscribe<any>('addon-a', node => {
    observed.push({
      node,
      snapshot: store.snapshot(),
    });
  });

  store.write('addon-a', {
    enabled: true,
    state: { child: { visible: false } },
  });

  assert.equal(observed.length, 1);
  assert.deepEqual((observed[0] as any).node, {
    enabled: true,
    state: { child: { visible: false } },
  });
  assert.deepEqual(
    (observed[0] as any).snapshot.addons['addon-a'],
    (observed[0] as any).node,
  );

  release();
});

test('master visual isolation changes only document visual projection state', () => {
  const store = createChartRuntimeAddonStateStore({
    schemaVersion: 1,
    visualsVisible: true,
    addons: {
      'addon-a': {
        enabled: true,
        state: { child: { visible: false } },
      },
      'addon-b': {
        enabled: false,
        state: { threshold: 7 },
      },
    },
  });

  const before = store.snapshot();
  store.setVisualsVisible(false);
  const hidden = store.snapshot();

  assert.equal(hidden.visualsVisible, false);
  assert.deepEqual(hidden.addons, before.addons);

  store.setVisualsVisible(true);
  const restored = store.snapshot();
  assert.equal(restored.visualsVisible, true);
  assert.deepEqual(restored.addons, before.addons);
});

test('replace restores one complete per-chart add-on JSON document', () => {
  const store = createChartRuntimeAddonStateStore();
  const restored: ChartRuntimeAddonStateDocument = {
    schemaVersion: 1,
    visualsVisible: false,
    addons: {
      'addon-a': {
        enabled: true,
        state: {
          nested: {
            one: true,
            two: false,
            value: 21,
          },
        },
      },
    },
  };

  store.replace(restored);
  assert.deepEqual(store.snapshot(), restored);
});

test('generic state owner contains no concrete add-on names or feature branches', async () => {
  const source = await fs.readFile(new URL('../src/chart/runtimeAddonState.ts', import.meta.url), 'utf8');

  assert.equal(source.includes('addons/chart-'), false);
  assert.equal(source.includes('IndicatorHost'), false);
  assert.equal(source.includes('StrategyHost'), false);
  assert.equal(source.includes('switch ('), false);
  assert.equal(source.includes('runtime.series'), false);
  assert.equal(source.includes('addSeries'), false);
  assert.equal(source.includes('removeSeries'), false);
});
