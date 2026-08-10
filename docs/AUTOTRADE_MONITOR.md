# AutoTrade Monitor Contract

## 목적

`AutoTradeForm`은 전략 작성기나 전략 최적화 화면이 아니다.
표준 Kiwoom REST Workbench에서 선택적 Strategy Add-on의 실행 상태를 중앙에서 관찰하고,
실계좌 주문 안전 잠금만 제어하는 중립 관제판이다.

```text
Chart Strategy Add-on
  -> StrategySignal
  -> StrategyTradeIntent
  -> optional StrategyExecutionRuntime
       -> StrategyPortfolioChanged

AutoTradeForm
  <- StrategySignal
  <- StrategyPortfolioChanged
  -> StrategyPortfolioRequest
  -> StrategyBrokerArm
```

## 경계

`AutoTradeForm`은 다음을 하지 않는다.

- 전략 계산식 구현
- 전략 파라미터 수정
- 전략 JSON 저장/복원
- Kiwoom 주문 API 직접 호출
- 체결조회 API 직접 호출
- 가격 실시간 구독 등록
- 계좌 잔고 REST 자동조회

따라서 Strategy Add-on을 제거해도 AutoTradeForm과 기본 Workbench는 컴파일 가능하며,
관제판은 `RUNTIME WAIT` 상태로 남는다.

실제 주문 실행은 계속 다음 선택적 add-on이 소유한다.

```text
addons/chart-strategies/execution.ts
```

## 표시 항목

### Runtime 상태

- `RUNTIME ONLINE`: `StrategyPortfolioChanged` snapshot을 실제로 수신함
- `RUNTIME WAIT`: 선택적 전략 실행기가 아직 설치되지 않았거나 상태 snapshot을 아직 받지 못함

### Broker 안전 잠금

- `BROKER LOCKED`: 기본값. 실제 전략 broker 주문 차단
- `BROKER ARMED`: 현재 브라우저 세션에서 사용자가 명시적으로 확인 후 해제

앱을 다시 시작하면 실행 runtime의 broker 상태는 항상 LOCKED로 돌아간다.
AutoTradeForm에서도 ARM 전에 `confirm()`을 반드시 거친다.

### 전략 포지션 / 주문

중앙 `StrategyPortfolioSnapshot`을 그대로 표시한다.

- PAPER OPEN
- BUY PENDING
- BROKER OPEN
- SELL PENDING
- ERROR
- 전략명 / 인스턴스 ID
- 종목 / 수량 / 체결수량
- 진입가 / 현재가 / 손익률
- 주문번호 / 갱신시각

Paper 상태를 실제 계좌 잔고와 합치지 않는다.
실제 계좌 상태는 `AccountForm`이 계속 Kiwoom 계좌 API를 통해 별도로 조회한다.

### 최근 전략 신호

현재 브라우저 세션에서 EventBus로 새로 들어온 `StrategySignal`만 최대 100건 표시한다.
과거 차트를 열었을 때 이미 계산돼 있는 marker를 거래 이벤트처럼 재생하지 않는다.

이는 다음 두 개념을 구분하기 위함이다.

```text
historical marker = 과거 계산 결과
live StrategySignal = 현재 세션에서 새로 발생한 사건
```

## 안전 원칙

1. AutoTradeForm은 주문 API를 직접 호출하지 않는다.
2. broker ARM은 명시적 사용자 확인이 필요하다.
3. LOCK은 즉시 가능하다.
4. 전략 주문번호를 받았다는 이유만으로 체결 완료로 표시하지 않는다.
5. 체결 상태는 StrategyExecutionRuntime의 `ka10076` reconciliation 결과만 사용한다.
6. 관제판을 열어두는 것만으로 REST 요청이나 WS 등록 수가 증가하지 않는다.

## 표준 프로젝트에서의 위치

```text
src/forms/AutoTradeForm.ts
    UI / EventBus monitor only

src/core/events.ts
    neutral strategy execution contracts

addons/chart-strategies/
    optional strategy authoring + execution implementation

src/forms/AccountForm.ts
    real account API + strategy portfolio summary
```

다른 프로젝트는 자체 전략 엔진을 사용하더라도 동일한 EventBus payload를 발행하면
`AutoTradeForm`과 `AccountForm`을 그대로 참고할 수 있다.

## 검증

`npm run test:autotrade`에서 최소 다음을 고정한다.

- `autotrade`가 실제 singleton Form으로 등록됨
- Activity Bar / 거래 메뉴 진입점
- Portfolio request/change 계약
- StrategySignal 관찰 계약
- Broker ARM confirmation gate
- AutoTradeForm 안에 `ctx.api.call`, `kt10000`, `kt10001` 없음
- StrategyExecutionRuntime은 optional add-on 내부에 유지
- AccountForm의 실제 계좌/전략상태 분리 유지
