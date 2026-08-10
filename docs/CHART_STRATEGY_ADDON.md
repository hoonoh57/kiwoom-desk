# Chart Strategy Add-on

## 목적

차트에서 발견한 매매 아이디어를 대화나 ChartForm 하드코딩으로 흘리지 않고,
지표 add-on과 같은 방식의 독립 전략 플러그인으로 저장·복원·검증·실행한다.

전략 add-on을 제거해도 기본 캔들/거래량/지표 차트는 그대로 동작해야 한다.

## 현재 완료선

이 저장소에서 전략 기능의 목적은 **수익전략 완성**이 아니라 **범용 전략 add-on 실행 틀 제공**이다.

`VWAP-JMA Reclaim`은 앞으로 수익성을 계속 최적화하는 production 전략이 아니라 다음 연결을 검증하는
**Reference Strategy / Validation Sample**로 동결한다.

```text
strategy plugin
  -> parameter / JSON
  -> reset + append/replace
  -> ARM/BUY/SELL marker
  -> signal / paper / broker TradeIntent
  -> 중앙 StrategyExecutionRuntime
  -> AccountForm 전략 매매 현황
```

새로운 진입필터, 청산 최적화, 대장주 선정, 특정 틱봉/시간대 최적화 등 실제 전략 연구는
별도 strategy-lab/trading-strategies 계층에서 수행하고 기본 Workbench를 오염시키지 않는다.

## 물리적 경계

```text
src/forms/ChartForm.ts
  - 전략 이름/조건/주문 API를 모른다.
  - 기존 ChartExtension 수명주기만 전달한다.

addons/chart-strategies/
  api.ts                   외부 전략용 public registration API
  registry.ts              Vite와 독립된 strategy plugin registry
  catalog.ts               로컬 plugins/*.ts 자동 발견
  types.ts                 전략/JSON 계약
  StrategyHost.ts          UI, JSON, 차트 marker, 확정봉 TradeIntent
  execution.ts             signal/paper/broker 중앙 실행기
  register.ts              전략 add-on 설치점
  plugins/*.ts             로컬/reference 전략
```

`src/main.ts`는 전략 add-on을 직접 정적 import하지 않고 optional `import.meta.glob` loader로 찾는다.
따라서 `addons/chart-strategies/` 폴더가 물리적으로 없는 배포에서도 base Workbench가 전략 모듈 resolve 때문에
실패하지 않는 경계를 유지한다.

기본 `tsconfig.json`의 TypeScript root도 `src`, `server`만 포함하고 `addons`는 포함하지 않는다.

## 외부 전략 등록 포트

저장소 내부 전략은 기존처럼 `plugins/*.ts`에 넣으면 자동 발견된다.
외부 전략 패키지/add-on은 ChartForm이나 catalog switch를 수정하지 않고 public API를 사용한다.

```ts
import {
  registerStrategyPlugin,
  type StrategyPlugin,
} from './addons/chart-strategies/api';

const plugin: StrategyPlugin = {
  id: 'my-strategy',
  version: 1,
  label: 'My Strategy',
  parameters: [],
  create() {
    return {
      reset(bars) { return { signals: [] }; },
      update(bars, change) { return { signals: [] }; },
    };
  },
};

const unregister = registerStrategyPlugin(plugin);
```

등록 ID는 전역 strategy catalog에서 유일해야 하며 중복 ID는 즉시 오류다.
`registerStrategyPlugin()`은 disposer를 반환하므로 등록 소유자가 catalog 등록을 회수할 수 있다.

현재 Workbench 계약에서는 외부 전략 add-on을 **Workbench가 차트를 만들기 전에 등록**하는 것을 기본으로 한다.
차트별 전략 적용/비적용은 StrategyHost의 instance enabled/remove 기능으로 처리한다.

production 전략 목록을 오염시키지 않기 위해 범용성 검증용 두 번째 전략은 `tests/strategyAddon.test.ts` 안에서만
동적으로 등록/제거한다.

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
      "pluginVersion": 3,
      "enabled": true,
      "params": {
        "jmaPeriod": 14,
        "jmaPhase": 50,
        "jmaPower": 2,
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
- FAIL: 회색 원(다른 전략이 사용할 수 있으나 VWAP-JMA v3 기본 진입에서는 사용하지 않음)

marker 표시 여부는 전략 instance별로 끌 수 있다.

## Reference Strategy: VWAP-JMA Reclaim

이 전략은 완성된 수익전략이라는 가정이 아니라 플랫폼 전체 연결을 검증하는 기준 구현이다.
이 저장소에서는 v3 진입계약을 기준으로 동결하며, 이후 수익성 개선을 이유로 기본 프레임워크를 변경하지 않는다.

### v3 진입 계약

VWAP cross를 사건으로 사용하고 JMA는 방향 확인만 담당한다.

```text
BLOCKED
  -> 직전 Close >= 직전 VWAP
     AND 현재 Close < 현재 VWAP
     : 실제 VWAP 하향돌파 → ARM

ARMED
  -> 직전 Close <= 직전 VWAP
     AND 현재 Close > 현재 VWAP
     : 실제 VWAP 상향 재돌파
     AND 현재 JMA > 직전 JMA
     : JMA 상승
     → BUY

  -> 상향 재돌파 순간 JMA가 상승이 아니면 추격 BUY하지 않는다.
     ARM을 유지하고 다음 실제 VWAP 상향 재돌파를 기다린다.

  -> ARM 유효봉 만료 없음
  -> 진입용 FAIL 없음

LONG
  -> 선택한 exitMode 구조 이탈 → SELL
```

v3 기본 진입에서는 다음 지연 조건을 사용하지 않는다.

- `Close > JMA`
- `JMA > VWAP`
- `maxEntrySigma`
- `armExpiryBars`

JMA 상승의 현재 정의는 가장 단순한 1봉 기울기다.

```text
JMA(t) > JMA(t-1)
```

### 재진입

기본 `vwap-close` 청산에서는 LONG 상태에서 종가가 VWAP을 하향돌파하면 SELL과 동시에 다음 reclaim을 기다리는 ARMED 상태로 전환한다.
따라서 청산 직후 다시 VWAP을 상향돌파하면서 JMA가 상승하면 재진입 신호를 만들 수 있다.

### 청산 옵션

Reference Strategy는 프레임워크 검증을 위해 다음 파라미터 contract만 유지한다.

- `vwap-close`: 종가 VWAP 이탈
- `jma-close`: 종가 JMA 이탈
- `jma-below-vwap`: JMA<VWAP + 종가 JMA 이탈

이 옵션들의 실제 수익성 비교·최적화는 이 저장소의 완료조건이 아니다.

### v1/v2 저장본 마이그레이션

v3 로드 시 이전 저장본의 다음 파라미터는 현재 plugin parameter 목록에 없으므로 자동 제거된다.

- `requireJmaAboveVwap`
- `maxEntrySigma`
- `armExpiryBars`

사용자가 localStorage를 삭제하거나 전략을 다시 추가할 필요가 없다.

## 전략 플러그인 작성 원칙

새 전략은 로컬이라면 `addons/chart-strategies/plugins/<name>.ts`, 외부라면 `api.ts`의
`registerStrategyPlugin()` 포트로 추가한다.

ChartForm이나 중앙 switch 문을 수정하지 않는다.

전략 계산기는 반드시:

- `reset(allBars)`
- `update(bars, append|replace)`

계약을 제공한다.

진행봉 replace에서 누적 상태를 중복 반영하지 않아야 하며,
append/replace 결과는 같은 데이터의 fresh reset 결과와 parity가 맞아야 한다.

전략이 지표를 사용하면 이미 검증된 indicator calculator를 재사용해 계산식 drift를 막는다.

## 검증

`npm run test:strategies`에서 최소 다음을 검사한다.

- Reference VWAP-JMA deterministic ARM/BUY 발생
- 모든 ARM이 실제 VWAP 하향돌파 봉에만 발생
- 모든 BUY가 실제 VWAP 상향 재돌파 봉에만 발생
- 모든 BUY에서 JMA가 상승
- VWAP-JMA v3 기본 진입에서 FAIL 미발생
- v1/v2 저장 파라미터의 v3 정규화
- append parity
- replace parity
- 외부 test-only 전략의 register/list/unregister
- duplicate strategy ID 차단
- ChartForm에 전략 이름/주문 로직 하드코딩 없음
- strategy add-on optional glob 설치 경계
- base TypeScript roots에서 addons 제외
- broker confirmed ARM gate
- 매수/매도 API 경로
- 주문 체결확인 API 경로
- AccountForm 전략 portfolio 연동

이 검증이 통과하면 Strategy Add-on Framework는 이 저장소에서 DONE으로 취급하고,
다음 표준 Workbench 기능(Watchlist/Settings/AutoTrade 관제)으로 이동한다.
