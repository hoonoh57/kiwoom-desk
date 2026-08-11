import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canApplyLinkedSymbol,
  chartForcedLockReason,
  chartTradeLockReason,
} from '../src/chart/windowPolicy';

test('기본 사용자 잠금은 외부 종목 연동을 차단한다', () => {
  assert.equal(canApplyLinkedSymbol(true, 'manual', '005930', []), false);
});

test('잠금 해제된 수동/반자동 차트는 외부 종목 연동을 허용한다', () => {
  assert.equal(canApplyLinkedSymbol(false, 'manual', '005930', []), true);
  assert.equal(canApplyLinkedSymbol(false, 'semi', '005930', []), true);
});

test('AUTO 차트는 사용자 잠금 해제 여부와 무관하게 종목을 강제 고정한다', () => {
  assert.equal(chartForcedLockReason('auto', '005930', []), 'AUTO 종목 고정');
  assert.equal(canApplyLinkedSymbol(false, 'auto', '005930', []), false);
});

test('전략 주문/보유 상태는 현재 종목을 강제 잠근다', () => {
  const statuses = [
    ['broker-pending-buy', '매수 주문중'],
    ['broker-open', '보유중'],
    ['broker-pending-sell', '매도 주문중'],
    ['broker-error', '주문 오류 확인 필요'],
    ['paper-open', 'Paper 보유중'],
  ] as const;

  for (const [status, label] of statuses) {
    const positions = [{ code: '005930', status }];
    assert.equal(chartTradeLockReason('005930', positions), label);
    assert.equal(canApplyLinkedSymbol(false, 'manual', '005930', positions), false);
  }
});

test('다른 종목의 포지션은 현재 차트를 잠그지 않는다', () => {
  const positions = [{ code: '000660', status: 'broker-open' }];
  assert.equal(chartTradeLockReason('005930', positions), '');
  assert.equal(canApplyLinkedSymbol(false, 'manual', '005930', positions), true);
});

test('A 접두 종목코드도 동일 종목으로 정규화한다', () => {
  const positions = [{ code: 'A005930', status: 'broker-open' }];
  assert.equal(chartTradeLockReason('005930', positions), '보유중');
});

test('복수 상태가 있으면 주문 오류/진행 상태를 우선 표시한다', () => {
  const positions = [
    { code: '005930', status: 'paper-open' },
    { code: '005930', status: 'broker-open' },
    { code: '005930', status: 'broker-pending-sell' },
  ];
  assert.equal(chartTradeLockReason('005930', positions), '매도 주문중');
});
