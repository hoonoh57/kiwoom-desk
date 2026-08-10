import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  defaultWorkbenchSettings,
  importWorkbenchSettings,
  loadWorkbenchSettings,
  normalizeWorkbenchSettings,
  resetWorkbenchSettings,
  saveWorkbenchSettings,
  WORKBENCH_SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from '../src/settings';

class MemoryStorage implements SettingsStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

test('settings normalize invalid values to safe standard defaults', () => {
  const defaults = defaultWorkbenchSettings();
  const s = normalizeWorkbenchSettings({
    general: { defaultSymbol: ' A005930 ', restoreLayout: 'yes' },
    chart: { defaultPeriod: 'invalid' },
    order: { defaultExchange: 'BAD', defaultQuantity: -5, defaultOrderType: '999' },
  });

  assert.equal(s.schemaVersion, 1);
  assert.equal(s.general.defaultSymbol, '005930');
  assert.equal(s.general.restoreLayout, defaults.general.restoreLayout);
  assert.equal(s.chart.defaultPeriod, defaults.chart.defaultPeriod);
  assert.equal(s.order.defaultExchange, defaults.order.defaultExchange);
  assert.equal(s.order.defaultQuantity, defaults.order.defaultQuantity);
  assert.equal(s.order.defaultOrderType, defaults.order.defaultOrderType);
});

test('settings store persists, reloads and resets browser-only preferences', () => {
  const storage = new MemoryStorage();
  const saved = saveWorkbenchSettings(normalizeWorkbenchSettings({
    general: { defaultSymbol: '000660', restoreLayout: false },
    chart: { defaultPeriod: 'min' },
    order: { defaultExchange: 'SOR', defaultQuantity: 7, defaultOrderType: '3' },
  }), storage);

  assert.ok(storage.getItem(WORKBENCH_SETTINGS_STORAGE_KEY));
  assert.deepEqual(loadWorkbenchSettings(storage), saved);
  assert.deepEqual(resetWorkbenchSettings(storage), defaultWorkbenchSettings());
  assert.equal(storage.getItem(WORKBENCH_SETTINGS_STORAGE_KEY), null);
});

test('settings JSON import ignores unknown fields and never requires server secrets', () => {
  const imported = importWorkbenchSettings(JSON.stringify({
    schemaVersion: 999,
    general: { defaultSymbol: '035420', restoreLayout: true },
    chart: { defaultPeriod: 'tick' },
    order: { defaultExchange: 'NXT', defaultQuantity: 3, defaultOrderType: '0' },
    KIWOOM_REAL_SECRET_KEY: 'must-not-be-part-of-contract',
  }));

  assert.equal(imported.general.defaultSymbol, '035420');
  assert.equal(imported.chart.defaultPeriod, 'tick');
  assert.equal(imported.order.defaultExchange, 'NXT');
  assert.equal('KIWOOM_REAL_SECRET_KEY' in (imported as any), false);
});

test('SettingsForm is a real singleton and does not expose env credential fields', () => {
  const root = path.resolve(process.cwd());
  const registry = fs.readFileSync(path.join(root, 'src/forms/registry.ts'), 'utf8');
  const form = fs.readFileSync(path.join(root, 'src/forms/SettingsForm.ts'), 'utf8');

  assert.match(registry, /settings:\s*\(c, p\) => new SettingsForm\(c, p\)/);
  assert.equal(registry.includes("settings:  ph('settings')"), false);
  assert.match(registry, /settings:.*instance: 'singleton'/);
  assert.equal(/KIWOOM_(?:MOCK|REAL)?_?(?:APP_KEY|SECRET_KEY)/.test(form), false);
  assert.equal(/process\.env/.test(form), false);
});

test('Workbench and commands consume default chart period and layout restore settings', () => {
  const root = path.resolve(process.cwd());
  const workbench = fs.readFileSync(path.join(root, 'src/shell/Workbench.ts'), 'utf8');
  const commands = fs.readFileSync(path.join(root, 'src/core/commands.ts'), 'utf8');

  assert.match(workbench, /settings\.general\.restoreLayout \? dock\.restoreLayout\(\) : false/);
  assert.match(workbench, /period: settings\.chart\.defaultPeriod/);
  assert.match(commands, /loadWorkbenchSettings\(\)\.chart\.defaultPeriod/);
  assert.equal(commands.includes("open('chart', { apiId: 'ka10081'"), false);
});

test('OrderForm consumes standard order defaults but keeps confirmation gate', () => {
  const root = path.resolve(process.cwd());
  const order = fs.readFileSync(path.join(root, 'src/forms/OrderForm.ts'), 'utf8');

  assert.match(order, /settings\.order\.defaultQuantity/);
  assert.match(order, /settings\.order\.defaultExchange/);
  assert.match(order, /settings\.order\.defaultOrderType/);
  assert.match(order, /if \(!confirm\(/);
});
