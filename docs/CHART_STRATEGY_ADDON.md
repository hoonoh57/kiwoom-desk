# Chart Strategy Add-on

## 목적

차트에서 발견한 매매 아이디어를 대화나 ChartForm 하드코딩으로 흘리지 않고,
지표 add-on과 같은 방식의 독립 전략 플러그인으로 저장·복원·검증·실행한다.

전략 add-on을 제거해도 기본 캔들/거래량/지표 차트는 그대로 동작해야 한다.

## 물리적 경계

```text
src/forms/ChartForm.ts
  - 전략 이름/조건/주문 API를 모른다.
  - 기존 ChartExtension 수명주기만 전달한다.

addons/chart-strategies/
  catalog.ts               전략 자동 발견
  types.ts                 전략/JSON 계약
  StrategyHost.ts          UI, JSON, 차트 marker, 확정봉 TradeIntent
  execution.ts             signal/paper/broker 중앙 실행기
  register.ts              단일 설치점
  plugins/*.ts             실제 전략
```

`src/main.ts`의 `addons/chart-strategies/register` dynamic import 및
`installChartStrategyAddon(ctx)` 호출을 제거하면 전략 add-on과 전략 주문 실행기가 빠진다.

## 전략 저장 계약

계산 결과나 주문 결과가 아니라 다음 설정만 localStorage JSON으로 저장한다.

- strategyId
- pluginVersion
- instanceId
- enabled
- params
- execution.mode
- execution.qty
- execution.exchange
- execution.orderType
- showMarkers
- order

예:

```json
{
  "schemaVersion": 1,
  "strategies": [
    {
      "instanceId": "vwap-jma-reclaim-...",
      "strategyId": "vwap-jma-reclaim",
      "pluginVersion": 2,
      "enabled": true,
      "params": {
        "jmaPeriod": 14,
        "jmaPhase": 50,
        "jmaPower": 2,
        "requireJmaAboveVwap": false,
        "maxEntrySigma": 1,
        "armExpiryBars": 12,
        "exitMode": "vwap-close"
      },
      "execution": {
        "mode": "signal",
        "qty": 1,
        "exchange": "SOR",
        "orderType": "3"
      },
      "showMarkers": true,
      "order": 0
    }
  ]
}
```

전략 plugin version이 올라가면 `migrateParams()`를 통해 기존 저장 JSON을 새 계약으로 변환한다.
JSON을 다시 작성하거나 localStorage를 수동 삭제하도록 사용자에게 요구하지 않는다.

## 실행 모드

### signal

차트에 ARM/BUY/SELL/FAIL 신호만 표시한다. 주문하지 않는다.

### paper

확정봉 BUY/SELL을 중앙 실행기가 가상 포지션으로 처리한다.
실시간 체결 가격으로 현재가와 평가손익을 갱신한다.

### broker

현재 연결된 키움 투자모드(모의/실전)의 주문 API를 호출한다.

중요 안전계약:

1. 전략 JSON에 `mode=broker`가 저장돼 있어도 주문은 자동 허용되지 않는다.
2. 앱 시작 시 broker는 항상 LOCKED다.
3. 사용자가 현재 세션에서 별도 확인 후 ARM해야 주문을 보낼 수 있다.
4. BUY/SELL 신호는 진행 중 봉의 replace가 아니라 새 봉 append로 직전 봉이 확정된 뒤에만 주문 의도로 전달한다.
5. 주문번호 수신은 체결 완료가 아니다. 상태를 PENDING으로 두고 `ka10076`에서 주문번호 체결을 확인한 뒤 OPEN/종료로 전환한다.
6. 동일 strategyInstanceId+종목의 중복 BUY를 차단한다.

## 중앙 계좌현황

`AccountForm` 상단의 `전략 매매 현황`은 전략 실행기 snapshot만 표시한다.
키움 실제 잔고 응답과 전략 내부 상태를 같은 행으로 위장해 섞지 않는다.

표시 항목:

- 실행모드(PAPER/BROKER)
- 상태
- 전략명
- 종목
- 수량/체결수량
- 진입가
- 현재가
- 평가손익률
- 주문번호
- broker ARMED/LOCKED

## 차트 신호

Lightweight Charts v5 series markers primitive를 기본 candlestick series에 부착한다.
캔들 데이터 자체는 변경하지 않는다.

- ARM: 노란 원
- BUY: 초록 상향 화살표
- SELL: 빨간 하향 화살표
- FAIL: 회색 원

marker 표시 여부는 전략 instance별로 끌 수 있다.

## 첫 전략: VWAP-JMA Reclaim

이 전략은 완성된 수익전략이라는 가정이 아니라 검증 가능한 기준 구현이다.

### v2 진입 계약

`Close > VWAP`이라는 상태와 `VWAP을 방금 상향 재돌파했다`는 사건을 구분한다.
BUY는 반드시 실제 상향 재돌파 봉에서만 평가한다.

```text
BLOCKED
  -> Close<VWAP에서 JMA slope 상승: ARM

ARMED
  -> 직전 Close <= 직전 VWAP
     AND 현재 Close > 현재 VWAP       : 실제 VWAP 상향 재돌파
     AND 현재 Close > JMA
     AND JMA slope > 0
     AND maxEntrySigma 이하
     AND 선택적으로 JMA >= VWAP      : BUY

  -> 재돌파 순간 확인조건이 부족하면 나중에 상승한 자리에서 추격 BUY하지 않는다.
     다음 실제 VWAP 상향 재돌파를 기다린다.

  -> 유효봉 초과 또는 JMA 재하락      : FAIL

LONG
  -> 선택한 exitMode 구조 이탈        : SELL
```

`requireJmaAboveVwap`은 v2에서 기본 `false`다.
JMA는 VWAP보다 후행할 수 있으므로 기본 전략에서는 VWAP reclaim을 진입 트리거로 사용하고,
JMA는 상승 방향과 가격이 JMA 위에 있는지만 확인한다.

v1 저장본의 `requireJmaAboveVwap=true`는 v2 로드 시 `false`로 마이그레이션한다.
엄격 확인을 다시 켜는 것은 가능하지만, 이 경우 첫 reclaim에서 조건이 맞지 않으면
JMA가 뒤늦게 VWAP 위로 올라온 시점에 추격하지 않고 다음 실제 reclaim을 기다린다.

모든 주요 문턱은 JSON parameter다. 실제 데이터 검증 결과에 따라 수정하고 버전업한다.

## 전략 플러그인 작성 원칙

새 전략은 `addons/chart-strategies/plugins/<name>.ts` 하나로 추가한다.
Catalog는 `plugins/*.ts`를 자동 발견하므로 ChartForm이나 중앙 switch 문을 수정하지 않는다.

전략 계산기는 반드시:

- `reset(allBars)`
- `update(bars, append|replace)`

계약을 제공한다.

진행봉 replace에서 누적 상태를 중복 반영하지 않아야 하며,
append/replace 결과는 같은 데이터의 fresh reset 결과와 parity가 맞아야 한다.

전략이 지표를 사용하면 이미 검증된 indicator calculator를 재사용해 계산식 drift를 막는다.

## 검증

`npm run test:strategies`에서 최소 다음을 검사한다.

- 전략의 deterministic ARM/BUY 발생
- 모든 BUY가 실제 VWAP 상향 재돌파 봉에만 발생
- v1 -> v2 parameter migration
- append parity
- replace parity
- ChartForm에 전략 이름/주문 로직 하드코딩 없음
- add-on 단일 removable 등록점
- broker confirmed ARM gate
- 매수/매도 API 경로
- 주문 체결확인 API 경로
- AccountForm 전략 portfolio 연동
