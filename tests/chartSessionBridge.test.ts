import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChartRuntimeServiceIds,
  createChartRuntimeHost,
  resetChartRuntimePluginsForTests,
  type ChartRuntimeCoreState,
  type ChartRuntimeStateService,
} from '../src/chart/runtimeHost';
import { registerChartSessionStateBridge } from '../src/project/chartSessionBridge';

function coreService(initial: ChartRuntimeCoreState) {
  let state = structuredClone(initial);
  const subscribers = new Set<(value: ChartRuntimeCoreState) => void>();
  const service: ChartRuntimeStateService = {
    read: () => structuredClone(state),
    apply: next => {
      state = { ...state, ...structuredClone(next) };
      for (const handler of [...subscribers]) handler(structuredClone(state));
    },
    subscribe: handler => {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },
  };
  return {
    service,
    set(next: Partial<ChartRuntimeCoreState>) {
      service.apply(next);
    },
  };
}

test('chart session bridge restores one opaque parent envelope and publishes canonical child snapshots', () => {
  resetChartRuntimePluginsForTests();
  registerChartSessionStateBridge();

  const core = coreService({
    code: '000000',
    period: 'day',
    scope: '1',
    adjusted: true,
    volumeRaw: false,
  });
  const published: unknown[] = [];
  const parentParams = {
    chartState: {
      schemaVersion: 1,
      core: {
        code: '005930',
        period: 'min',
        scope: '5',
        adjusted: false,
        volumeRaw: true,
      },
      addons: {
        schemaVersion: 1,
        visualsVisible: true,
        addons: {
          'opaque-addon': {
            enabled: true,
            state: {
              child: {
                nested: {
                  visible: false,
                  value: 17,
                },
              },
            },
          },
        },
      },
    },
    onChartStateChange: (state: unknown) => published.push(structuredClone(state)),
  };

  const host = createChartRuntimeHost({
    getSymbol: () => core.service.read().code,
    initialServices: {
      [ChartRuntimeServiceIds.CHART_PARAMS]: parentParams,
      [ChartRuntimeServiceIds.CHART_STATE]: core.service,
    },
    reportError: message => assert.fail(message),
  });

  assert.deepEqual(core.service.read(), {
    code: '005930',
    period: 'min',
    scope: '5',
    adjusted: false,
    volumeRaw: true,
  });
  assert.deepEqual(host.getAddonStateSnapshot().addons['opaque-addon']?.state, {
    child: { nested: { visible: false, value: 17 } },
  });
  assert.equal(published.length, 1);
  assert.deepEqual(published[0], parentParams.chartState);

  core.set({ scope: '15' });
  assert.equal((published.at(-1) as any).core.scope, '15');
  assert.deepEqual((published.at(-1) as any).addons.addons['opaque-addon'].state, {
    child: { nested: { visible: false, value: 17 } },
  });

  host.setAddonVisualsVisible(false);
  const latest = published.at(-1) as any;
  assert.equal(latest.addons.visualsVisible, false);
  assert.deepEqual(latest.addons.addons['opaque-addon'].state, {
    child: { nested: { visible: false, value: 17 } },
  });

  host.dispose();
});

test('chart session bridge is feature-blind and parent contract stays opaque', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(
    new URL('../src/project/chartSessionBridge.ts', import.meta.url),
    'utf8',
  ));

  assert.equal(source.includes('chartState?: unknown'), true);
  assert.equal(source.includes('onChartStateChange?: (state: unknown)'), true);
  assert.equal(source.includes('runtime.addonState.replace(restored.addons)'), true);
  assert.equal(source.includes('runtime.addonState.subscribeDocument'), true);
  assert.equal(source.includes('Indicator'), false);
  assert.equal(source.includes('RSI'), false);
  assert.equal(source.includes('MACD'), false);
  assert.equal(source.includes('Strategy'), false);
});
