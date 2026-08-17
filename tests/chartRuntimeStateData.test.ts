import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ChartRuntimeServiceIds } from '../src/chart/runtimeHost';

test('Chart Runtime exposes generic state/data service ids without Workspace-specific APIs', () => {
  assert.equal(ChartRuntimeServiceIds.CHART_STATE, 'chart.state');
  assert.equal(ChartRuntimeServiceIds.CHART_DATA, 'chart.data');
  assert.equal(ChartRuntimeServiceIds.CHART_PERSISTENCE, 'chart.persistence');
});

test('ChartForm provides generic state/data capabilities through the one Host only', async () => {
  const source = await fs.readFile(new URL('../src/forms/ChartForm.ts', import.meta.url), 'utf8');

  assert.match(source, /CHART_RUNTIME_STATE_DATA_SERVICES_V1/);
  assert.match(source, /\[ChartRuntimeServiceIds\.CHART_STATE\]: this\.runtimeStateService\(\)/);
  assert.match(source, /\[ChartRuntimeServiceIds\.CHART_DATA\]: this\.runtimeDataService\(\)/);
  assert.match(source, /runtimeBootstrapOpen = false/);

  for (const forbidden of [
    '__workspace',
    'VirtualDesktop',
    'WorkspaceController',
    'workspaceStateScope',
    'workspaceRange',
  ]) {
    assert.equal(source.includes(forbidden), false, `base ChartForm leaked optional persistence domain: ${forbidden}`);
  }
});

test('opaque chart data snapshot requires the last committed data identity', async () => {
  const source = await fs.readFile(new URL('../src/forms/ChartForm.ts', import.meta.url), 'utf8');

  assert.match(source, /private runtimeDataIdentity\(\): string/);
  assert.match(source, /state\.code[\s\S]*state\.period[\s\S]*state\.scope[\s\S]*state\.adjusted/);
  assert.match(source, /const identity = this\.runtimeDataIdentity\(\)/);
  assert.match(source, /runtimeDataLoadedIdentity !== identity/);
  assert.match(source, /identity,/);
  assert.match(source, /raw\.identity !== this\.runtimeDataIdentity\(\)/);
  assert.match(source, /runtimeDataLoadedIdentity = this\.runtimeDataIdentity\(\)/);
  assert.match(source, /runtimeDataLoadedIdentity = ''/);
  assert.match(source, /if \(!more\) this\.runtimeDataLoadedIdentity = this\.runtimeDataIdentity\(\)/);
  assert.match(source, /this\.runtimeDataRestored = true/);
  assert.match(source, /presentRestoredRuntimeData\(\)/);
  assert.match(source, /세션 복원 · REST 재조회 없음/);
});

test('generic core-state apply is bootstrap-only and runtime changes publish through subscribers', async () => {
  const source = await fs.readFile(new URL('../src/forms/ChartForm.ts', import.meta.url), 'utf8');

  assert.match(source, /core state may only be applied during bootstrap/);
  assert.match(source, /runtimeStateSubscribers = new Set/);
  assert.match(source, /notifyRuntimeCoreState\(\)/);
  assert.match(source, /subscribe: handler =>/);
  assert.match(source, /runtimeStateSubscribers\.clear\(\)/);
});
