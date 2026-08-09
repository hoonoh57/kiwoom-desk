import test from 'node:test';
import assert from 'node:assert/strict';
import {
  intervalForKiwoomFlow,
  parseKiwoomRateLimit,
} from '../src/api/KiwoomClient';

test('rc=5 with embedded 1700 message is recognized as Kiwoom rate limit', () => {
  const info = parseKiwoomRateLimit(
    5,
    '[1700:허용된 API 요청 개수를 초과하였습니다. 유량=1, API ID=ka10081]',
  );

  assert.ok(info);
  assert.equal(info.code, 1700);
  assert.equal(info.flow, 1);
  assert.equal(info.apiId, 'ka10081');
});

test('direct return_code=1700 is recognized even without detailed message', () => {
  const info = parseKiwoomRateLimit(1700, 'rate limited');
  assert.ok(info);
  assert.equal(info.code, 1700);
});

test('ordinary rc=5 error is not misclassified as a rate limit', () => {
  assert.equal(
    parseKiwoomRateLimit(5, '입력값을 확인하세요.'),
    null,
  );
});

test('flow interval uses server allowance with a safety margin', () => {
  assert.equal(intervalForKiwoomFlow(1), 1050);
  assert.equal(intervalForKiwoomFlow(2), 550);
  assert.equal(intervalForKiwoomFlow(undefined), 1200);
});
