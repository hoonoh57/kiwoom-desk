# Chart Indicator Add-on

## 목적

차트의 REST/WebSocket 조회, 캔들 생성, 거래량, 실시간 증분 업데이트를 지표 계산과 분리한다.

`ChartForm`은 SMA, RSI, MACD, SuperTrend 같은 지표 이름이나 계산식을 알지 않는다.
지표는 선택적 Chart Extension으로 로드되며, 지표 추가기능이 실패해도 기본 차트는 계속 동작해야 한다.

## 제거 경계

앱 시작 시 `src/main.ts`에서 다음 선택적 import만 실행한다.

```ts
await import('../addons/chart-indicators/register')
```

이 import를 제거하면 indicator add-on은 등록되지 않는다.
`ChartForm`은 빈 `ChartExtensionGroup`으로 정상 동작하고 캔들/거래량/실시간 기능은 그대로 유지된다.

추가기능 모듈 로드 자체가 실패해도 `main.ts`의 catch 이후 기본 Kiwoom Desk가 계속 시작된다.

완전히 들어내려면 다음 두 작업만 하면 된다.

1. `src/main.ts`의 위 dynamic import 제거
2. `addons/chart-indicators/` 폴더 제거

indicator 구현은 기본 `src/` 트리 밖에 있으므로, import가 제거된 상태에서는 기본 `src`/`server` TypeScript 빌드와 물리적으로 분리된다.
기본 차트에 남는 것은 지표와 무관한 범용 `src/chart/extensions.ts` 확장 포트뿐이다.

## 기본 차트와 추가기능의 계약

기본 차트가 추가기능에 전달하는 이벤트는 세 가지다.

1. `onBarsReset(bars)`
   - 최초 조회
   - 과거 데이터 더보기
   - 틱 snapshot catch-up 등 전체 데이터가 다시 구성된 경우
2. `onBarChanged(bar, 'replace', bars)`
   - 현재 진행 중인 마지막 봉이 실시간 체결로 수정된 경우
3. `onBarChanged(bar, 'append', bars)`
   - 새 봉이 생성된 경우

실시간 경로에서 ChartForm은 indicator 전체 재계산을 수행하지 않는다.
각 plugin calculator가 자신의 마지막 상태만 갱신한다. RSI와 MACD처럼 누적 상태가 필요한 지표는 이전 봉 checkpoint에서 현재 마지막 봉만 다시 계산하여 진행봉 `replace`가 누적 상태를 오염시키지 않게 한다.

## 파일 구조

```text
src/chart/extensions.ts
addons/chart-indicators/
  register.ts
  IndicatorHost.ts
  catalog.ts
  types.ts
  indicator.css
  plugins/
    sma.ts
    rsi.ts
    obv.ts
    macd.ts
```

`catalog.ts`는 `plugins/*.ts`를 `import.meta.glob`으로 자동 발견한다.
새 지표를 추가할 때 ChartForm이나 IndicatorHost의 지표 목록을 수정하지 않는다.

## Plugin 계약

각 지표 파일은 `IndicatorPlugin` 하나를 default export 한다.

핵심 필드:

- `id`: 영구 식별자
- `version`: 계산/파라미터 계약 버전
- `label`: UI 이름
- `parameters`: 자동 파라미터 UI schema
- `outputs`: line/histogram 출력과 main/own pane 위치
- `stylePalette`: 저장된 style이 없는 동일 지표 인스턴스에 순서대로 배정할 기본 색상/스타일
- `defaultInstances`: 최초 기본 구성에 포함할 인스턴스
- `create(params)`: 계산 runtime 생성
- `migrateParams`: 구버전 JSON 파라미터 마이그레이션(선택)

같은 plugin은 `instanceId`가 다른 여러 인스턴스로 동시에 사용할 수 있다.

## JSON 저장 계약

저장 키:

```text
kiwoom-desk.chart.indicators.v1
```

기본 형태:

```json
{
  "schemaVersion": 1,
  "indicators": [
    {
      "instanceId": "sma-20",
      "indicatorId": "sma",
      "pluginVersion": 1,
      "enabled": true,
      "params": {
        "period": 20,
        "source": "close"
      },
      "style": {
        "value": {
          "color": "#98c379"
        }
      }
    }
  ]
}
```

계산 결과 배열은 저장하지 않는다.
차트를 다시 열면 JSON 설정만 읽고 현재 candle data로 indicator를 다시 계산한다.

플러그인이 현재 설치돼 있지 않은 `indicatorId`도 JSON 설정에서 삭제하지 않고 보존한다.
나중에 동일 id의 플러그인이 다시 설치되면 설정을 재사용할 수 있다.

## 현재 지원 지표

### SMA

- main pane overlay
- 기간 변경
- 기준값: close/open/high/low/HL2/HLC3/OHLC4
- 기존 MA5/20/60 기본값 유지
- style이 없는 과거 JSON도 인스턴스 순서에 따라 서로 다른 색상을 자동 보충

### RSI

- own pane
- Wilder RSI
- 기간, 과매수, 과매도 파라미터
- RSI line + upper/lower reference line
- 실시간 append/replace 증분 계산

### OBV

- own pane
- 상승봉 거래량 가산, 하락봉 거래량 차감
- 실시간 append/replace 증분 계산

### MACD

- own pane
- Fast EMA / Slow EMA / Signal 파라미터
- MACD line + Signal line + 양/음 histogram + zero line
- 실시간 append/replace 증분 계산

## 파라미터 UI

IndicatorHost는 plugin `parameters` schema를 읽어 number/integer/select/boolean 입력을 자동 생성한다.
파라미터를 바꾸면 설정 JSON을 즉시 저장하고 열린 다른 차트에도 같은 구성을 동기화한다.

## JSON UI

차트 툴바의 `지표` 버튼에서 다음 작업을 한다.

- 지표 추가
- 활성/비활성
- 파라미터 수정
- 인스턴스 삭제
- 현재 JSON 표시
- JSON 붙여넣기 적용
- 기본값 복원

## 실패 격리

- add-on module 로드 실패: 기본 앱 계속 시작
- Chart Extension factory 실패: 해당 extension만 제외
- 특정 indicator 생성 실패: 생성된 series 정리 후 다른 indicator 계속 동작
- 특정 indicator 실시간 계산 실패: 해당 indicator series만 제거하고 기본 차트와 다른 indicator 계속 동작
- localStorage 실패: 현재 세션 차트 동작 유지

## 검증

`tests/indicatorAddon.test.ts`에서 다음을 확인한다.

- 기존 MA5/20/60 default parity
- SMA 기본 3개 색상 상이
- SMA 전체 계산과 append/replace 증분값 일치
- RSI/OBV/MACD가 own pane 출력인지 확인
- RSI/OBV/MACD reset 결과와 append/replace 증분 결과 parity
- RSI 상승 데이터 100 확인
- OBV 기본 누적 규칙 확인
- MACD multi-output 계약 확인
- ChartForm에 지표 계산 하드코딩이 다시 들어오지 않음
- main.ts의 선택적 add-on 등록 경계 유지

`pull_and_verify.ps1`은 tick aggregation test를 실행하고, `addons/chart-indicators/register.ts`가 존재할 때 indicator add-on test도 실행한 뒤 production build를 수행한다.
애드온을 완전히 제거한 구성에서는 indicator test만 자동으로 건너뛴다.
