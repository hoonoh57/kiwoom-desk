import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

test('all standard Workbench forms are concrete, not placeholders', () => {
  const registry = read('src/forms/registry.ts');
  const expected = [
    ['welcome', 'WelcomeForm'],
    ['output', 'OutputForm'],
    ['log', 'LogForm'],
    ['stockInfo', 'StockInfoForm'],
    ['trRunner', 'TrRunnerForm'],
    ['chart', 'ChartWorkspaceForm'],
    ['account', 'AccountForm'],
    ['order', 'OrderForm'],
    ['condition', 'ConditionForm'],
    ['watchlist', 'WatchlistForm'],
    ['autotrade', 'AutoTradeForm'],
    ['settings', 'SettingsForm'],
  ] as const;

  for (const [id, ctor] of expected) {
    assert.match(
      registry,
      new RegExp(`${id}:\\s*\\(c, p\\) => new ${ctor}\\(c, p\\)`),
      `${id} must remain a concrete standard form`,
    );
  }
});

test('all chart addons remain physically optional at the bootstrap boundary', () => {
  const main = read('src/main.ts');
  const addons = ['chart-indicators', 'chart-strategies', 'chart-diagnostics'];

  for (const addon of addons) {
    assert.match(main, new RegExp(`import\\.meta\\.glob\\('\\.\\.\\/addons\\/${addon}\\/register\\.ts'\\)`));
    assert.equal(
      main.includes(`import('../addons/${addon}/register')`),
      false,
      `${addon} must not use a literal dynamic import`,
    );
  }
});

test('base TypeScript roots exclude removable addon implementations', () => {
  const tsconfig = JSON.parse(read('tsconfig.json')) as { include?: string[] };
  const roots = tsconfig.include ?? [];
  assert.equal(roots.includes('src'), true);
  assert.equal(roots.includes('server'), true);
  assert.equal(roots.some(x => x.startsWith('addons')), false);
});

test('central auto-trade monitor is observation/control only', () => {
  const form = read('src/forms/AutoTradeForm.ts');
  assert.equal(form.includes('ctx.api.call'), false);
  assert.equal(form.includes('kt10000'), false);
  assert.equal(form.includes('kt10001'), false);
  assert.equal(form.includes('ka10076'), false);
  assert.match(form, /StrategyPortfolioChanged/);
  assert.match(form, /StrategyBrokerArm/);
});

test('settings UI does not own Kiwoom secrets', () => {
  const form = read('src/forms/SettingsForm.ts');
  const model = read('src/settings/model.ts');
  for (const secret of ['APP_KEY', 'SECRET_KEY', 'KIWOOM_REAL_APP_KEY', 'KIWOOM_MOCK_APP_KEY']) {
    assert.equal(form.includes(secret), false);
    assert.equal(model.includes(secret), false);
  }
});

test('completion and handoff documents exist', () => {
  assert.equal(fs.existsSync(path.join(root, 'docs/WORKBENCH_AUDIT.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'docs/SESSION_HANDOFF.md')), true);
});
