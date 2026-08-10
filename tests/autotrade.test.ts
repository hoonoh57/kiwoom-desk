import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

test('AutoTradeForm is a real singleton form and no longer a placeholder', () => {
  const registry = read('src/forms/registry.ts');
  assert.match(registry, /import \{ AutoTradeForm \} from '\.\/AutoTradeForm';/);
  assert.match(registry, /autotrade:\s*\(c, p\) => new AutoTradeForm\(c, p\)/);
  assert.match(registry, /autotrade:\s*\{ title: '자동매매 관제'[\s\S]*instance: 'singleton'/);
  assert.equal(registry.includes("autotrade: ph('autotrade')"), false);
});

test('AutoTradeForm is an event-driven monitor and never owns Kiwoom order calls', () => {
  const source = read('src/forms/AutoTradeForm.ts');
  assert.match(source, /Topics\.StrategyPortfolioChanged/);
  assert.match(source, /Topics\.StrategyPortfolioRequest/);
  assert.match(source, /Topics\.StrategySignal/);
  assert.match(source, /Topics\.StrategyBrokerArm/);
  assert.equal(source.includes('ctx.api.call'), false);
  assert.equal(source.includes('kt10000'), false);
  assert.equal(source.includes('kt10001'), false);
  assert.equal(source.includes("addons/chart-strategies"), false);
});

test('broker unlock remains explicit and confirmed while lock is immediate', () => {
  const source = read('src/forms/AutoTradeForm.ts');
  assert.match(source, /if \(this\.portfolio\.brokerArmed\)/);
  assert.match(source, /armed: false,[\s\S]*confirmed: true/);
  assert.match(source, /const ok = confirm\(/);
  assert.match(source, /if \(!ok\) return;/);
  assert.match(source, /armed: true,[\s\S]*confirmed: true/);
});

test('monitor exposes positions and live strategy signals without replaying historical markers', () => {
  const source = read('src/forms/AutoTradeForm.ts');
  assert.match(source, /StrategyPositionSnapshot/);
  assert.match(source, /recentSignals/);
  assert.match(source, /현재 세션에서 수신한 전략 신호/);
  assert.match(source, /과거 차트 marker는 이 목록에 재생하지 않습니다/);
});

test('Workbench exposes AutoTradeForm from activity bar and Trade menu', () => {
  const source = read('src/shell/Workbench.ts');
  assert.match(source, /id: 'autotrade'[\s\S]*icon: 'rocket'[\s\S]*formId: 'autotrade'/);
  assert.match(source, /자동매매 관제', cmd: 'view\.open\.autotrade'/);
});

test('strategy execution remains physically inside the optional strategy addon', () => {
  const execution = read('addons/chart-strategies/execution.ts');
  const baseForm = read('src/forms/AutoTradeForm.ts');
  assert.match(execution, /kt10000/);
  assert.match(execution, /kt10001/);
  assert.match(execution, /ka10076/);
  assert.match(execution, /payload\?\.confirmed === true/);
  assert.equal(baseForm.includes('StrategyExecutionRuntime'), false);
});

test('AccountForm continues to expose strategy positions alongside real account data', () => {
  const account = read('src/forms/AccountForm.ts');
  assert.match(account, /Topics\.StrategyPortfolioChanged/);
  assert.match(account, /전략 매매 현황/);
  assert.match(account, /kt00018/);
});
