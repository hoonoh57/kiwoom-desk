# Workbench Settings Contract

## 목적

`SettingsForm`은 Kiwoom REST 인증/서버 설정 편집기가 아니라 Kiwoom Desk 사용자의 Workbench 기본 동작을 관리한다.
다른 프로젝트가 참고하거나 재사용할 수 있도록 저장 schema와 UI를 분리한다.

```text
src/settings/model.ts   순수 schema / normalize / default
src/settings/store.ts   browser localStorage persistence
src/settings/index.ts   재사용 진입점
src/forms/SettingsForm.ts UI
```

## 보안 경계

다음 값은 SettingsForm의 책임이 아니다.

- KIWOOM_MOCK_APP_KEY
- KIWOOM_MOCK_SECRET_KEY
- KIWOOM_REAL_APP_KEY
- KIWOOM_REAL_SECRET_KEY
- PORT
- token cache

이 값들은 서버 `.env`/server runtime이 소유한다.
브라우저 DOM, localStorage, Settings JSON에 API key/secret을 넣지 않는다.
SettingsForm은 `/api/kiwoom/status`의 모드/토큰 유효 여부만 read-only로 보여준다.

## schema v1

```json
{
  "schemaVersion": 1,
  "general": {
    "defaultSymbol": "005930",
    "restoreLayout": true
  },
  "chart": {
    "defaultPeriod": "day"
  },
  "order": {
    "defaultExchange": "KRX",
    "defaultQuantity": 1,
    "defaultOrderType": "3"
  }
}
```

저장 위치:

```text
localStorage['kiwoom-desk.settings.v1']
```

서버 데이터가 아니므로 Watchlist revision과 섞지 않는다.

## 실제 적용점

### general.defaultSymbol

Workbench 시작 시 `ctx.state.symbol`의 초기 종목으로 사용한다.
이미 실행 중 선택된 종목을 Settings 저장만으로 강제로 바꾸지 않는다.

### general.restoreLayout

앱 시작 시 저장 Dock layout을 복원할지 결정한다.
OFF여도 저장된 layout 자체를 삭제하지 않는다.
다음 시작에서 기본 Welcome/Chart/Output 배치를 사용한다.

### chart.defaultPeriod

일반적인 다음 경로에서 새 기본 차트를 열 때 사용한다.

- 시작 기본 layout
- Activity Bar 차트
- `Ctrl+1` 차트
- `view.open.chart` command

TR이 `apiId=ka10079~ka10094`를 명시해서 차트를 여는 경우에는 해당 TR 계약이 우선한다.
분/틱 세부 scope, 수정주가, 거래량 축 등 ChartForm 내부 표현은 현재 Settings가 소유하지 않는다.
설정 때문에 ChartForm 계산/실시간 로직을 오염시키지 않는다.

### order defaults

새 `OrderForm`을 초기화할 때 다음 기본값으로 사용한다.

- 거래소
- 수량
- 매매구분

호출자가 명시적 params를 주면 params가 우선한다.
실제 주문 전 `confirm()` 안전장치는 Settings로 해제할 수 없다.

## JSON import / export

SettingsForm은 현재 설정을 JSON으로 내보내고 다시 불러올 수 있다.
가져온 JSON은 항상 `normalizeWorkbenchSettings()`를 거쳐 알 수 없는 필드와 잘못된 값을 제거한다.
따라서 다른 프로젝트는 표준 schema를 확장하더라도 자신의 migration/normalize 단계에서 호환성을 관리한다.

## 확장 원칙

설정 항목은 다음 조건을 만족할 때만 표준 schema에 추가한다.

1. 실제 공통 소비자가 존재한다.
2. 특정 전략/조건식에 종속되지 않는다.
3. 비밀값이 아니다.
4. 기본 프로젝트의 핵심 계산/렌더링 로직을 설정 때문에 하드코딩하지 않는다.

예를 들어 전략별 손절률, VWAP 파라미터, 조건식 이름은 Workbench Settings가 아니라 각 add-on/응용 프로젝트의 설정이다.

## 검증

`npm run test:settings`에서 최소 다음을 검사한다.

- 잘못된 설정값의 안전한 기본값 복구
- localStorage save/load/reset
- JSON normalize
- API key/secret 계약 비포함
- `SettingsForm` singleton 실제 등록
- Workbench default symbol/layout/default chart 적용
- OrderForm 기본값 적용
- 주문 확인 gate 유지
