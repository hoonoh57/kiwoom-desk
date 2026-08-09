# Chart Indicator Add-on

## 목적

차트의 REST/WebSocket 조회, 캔들 생성, 거래량, 실시간 증분 업데이트를 지표 계산과 분리한다.

`ChartForm`은 SMA, RSI, OBV, MACD, SuperTrend, DMI 같은 지표 이름이나 계산식을 알지 않는다.
지표는 선택적 Chart Extension으로 로드되며, 지표 추가기능이 실패해도 기본 차트는 계속 동작해야 한다.

## 제거 경계

앱 시작 시 `src/main.ts`에서 다음 선택적 import만 실행한다.

```ts
await import('../addons/chart-indicators/register')
```

이 import를 제거하면 indicator add-on은 등록되지 않는다.
`ChartForm`은 빈 `ChartExtensionGroup`으로 정상 동작하고 캔들/거래량/실시간 기능은 그대로 유지된다.

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
모든 plugin calculator는 `append/replace`에서 마지막 출력만 반환하고 IndicatorHost는 해당 series에 `update()`만 호출한다.
초기조회/더보기처럼 전체 데이터가 바뀐 경우에만 `reset()` + `setData()`를 사용한다.

RSI, MACD, SuperTrend, DMI처럼 누적 상태가 필요한 지표는 이전 봉 checkpoint에서 현재 마지막 봉만 다시 계산하여 진행봉 `replace`가 누적 상태를 오염시키지 않게 한다.
RSI/OBV Signal도 전체 과거를 다시 계산하지 않고 최근 Signal 기간 값만 사용해 마지막 Signal 점을 계산한다.

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
    supertrend.ts
    dmi.ts
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

## JSON 저장 계약 v2

현재 저장 키:

```text
kiwoom-desk.chart.indicators.v2
```

이전 `kiwoom-desk.chart.indicators.v1` 저장값이 있으면 최초 로드 시 v2로 자동 마이그레이션한다.
지표 plugin version이 올라가 새 파라미터가 추가된 경우 기존 JSON은 그대로 유지하면서 누락된 파라미터만 plugin 기본값으로 보충한다.

기본 형태:

```json
{
  "schemaVersion": 2,
  "indicators": [
    {
      "instanceId": "sma-20",
      "indicatorId": "sma",
      "pluginVersion": 1,
      "enabled": true,
      "order": 0,
      "params": {
        "period": 20,
        "source": "close"
      },
      "style": {
        "value": {
          "color": "#98c379"
        }
      }
    },
    {
      "instanceId": "rsi-1",
      "indicatorId": "rsi",
      "pluginVersion": 2,
      "enabled": true,
      "order": 1,
      "paneHeight": 135,
      "params": {
        "period": 14,
        "signalPeriod": 7,
        "upper": 70,
        "lower": 30
      }
    }
  ]
}
```

계산 결과 배열은 저장하지 않는다.
차트를 다시 열면 JSON 설정만 읽고 현재 candle data로 indicator를 다시 계산한다.

`order`는 지표 목록 및 own-pane 생성 순서를 보존한다.
`paneHeight`는 own-pane의 사용자 높이를 픽셀 단위로 보존한다.
Lightweight Charts의 최소 pane 높이 30px 미만 값은 저장하지 않는다.

차트 separator를 사용자가 드래그해 높이를 바꾸면 pointer-up 이후 실제 `PaneApi.getHeight()`를 읽어 저장하고, 다음 로드 때 `setHeight()`로 복원한다.
지표 설정창의 ↑/↓ 버튼으로 순서를 바꾸면 JSON의 `order`와 실제 pane 생성 순서가 함께 바뀐다.
마지막 series가 제거된 own-pane은 Lightweight Charts 계약에 따라 자동 제거된다.

플러그인이 현재 설치돼 있지 않은 `indicatorId`도 JSON 설정에서 삭제하지 않고 보존한다.
나중에 동일 id의 플러그인이 다시 설치되면 설정을 재사용할 수 있다.

## 현재 지원 지표

### SMA

- main pane overlay
- 기간 변경
- 기준값: close/open/high/low/HL2/HLC3/OHLC4
- 기존 MA5/20/60 기본값 유지
- style이 없는 과거 JSON도 인스턴스 순서에 따라 서로 다른 색상을 자동 보충
- 실시간 append/replace 마지막 SMA 점만 갱신

### RSI

- own pane
- Wilder RSI
- 기본: RSI 14 + Signal 7
- Signal은 RSI 값의 단순 이동평균이며 RSI 본선과 다른 색으로 표시
- 기간, Signal, 과매수, 과매도 파라미터 수정 가능
- RSI line + Signal line + upper/lower reference line
- 실시간 append/replace에서 RSI와 Signal 마지막 점만 갱신

### OBV

- own pane
- 상승봉 거래량 가산, 하락봉 거래량 차감
- 기본 Signal 20
- Signal은 OBV 값의 단순 이동평균이며 OBV 본선과 다른 색으로 표시
- Signal 기간 수정 가능
- 실시간 append/replace에서 OBV와 Signal 마지막 점만 갱신

### MACD

- own pane
- Fast EMA / Slow EMA / Signal 파라미터
- MACD line + Signal line + 양/음 histogram + zero line
- 실시간 append/replace 마지막 출력만 갱신

### SuperTrend

- main pane overlay
- ATR 기간 / 배수 파라미터
- Wilder ATR
- 상승 추세는 한국식 상승색, 하락 추세는 하락색으로 point color 표시
- 실시간 append/replace 마지막 SuperTrend 점만 갱신

### DMI / ADX

- own pane
- Wilder Directional Movement 방식
- 기본 기간 14, ADX 강도 기준 20
- `+DI` 상승 방향성, `-DI` 하락 방향성, `ADX` 추세 강도를 서로 다른 색으로 표시
- ADX 강도 기준선을 함께 표시
- 기간과 ADX 기준값 수정 가능
- 실시간 append/replace에서 현재 봉의 +DI/-DI/ADX 마지막 점만 갱신

## 파라미터 및 pane UI

IndicatorHost는 plugin `parameters` schema를 읽어 number/integer/select/boolean 입력을 자동 생성한다.
파라미터를 바꾸면 설정 JSON을 즉시 저장하고 열린 다른 차트에도 같은 구성을 동기화한다.

차트 툴바의 `지표` 버튼에서 다음 작업을 한다.

- 지표 추가
- 활성/비활성
- 파라미터 수정
- ↑/↓ 순서 이동
- 인스턴스 삭제
- 현재 pane 높이 확인
- 현재 JSON 표시
- JSON 붙여넣기 적용
- 기본값 복원

## 실패 격리

- add-on module 로드 실패: 기본 앱 계속 시작
- Chart Extension factory 실패: 해당 extension만 제외
- 특정 indicator 생성 실패: 생성된 series 정리 후 다른 indicator 계속 동작
- 특정 indicator 실시간 계산 실패: 해당 indicator series만 제거하고 기본 차트와 다른 indicator 계속 동작
- localStorage 실패: 현재 세션 차트 동작 유지

## 실시간 증분 불변식

모든 지표는 다음 불변식을 지킨다.

```text
최초 조회 / 더보기
    -> calculator.reset(allBars)
    -> series.setData(allPoints)

실시간 현재봉 수정
    -> calculator.update(bars, 'replace')
    -> series.update(lastPoint)

새 봉 생성
    -> calculator.update(bars, 'append')
    -> series.update(newPoint)
```

실시간 체결마다 전체 indicator history를 `setData()` 하지 않는다.

## 검증

`tests/indicatorAddon.test.ts`에서 다음을 확인한다.

- 기존 MA5/20/60 default parity
- SMA 기본 3개 색상 상이
- RSI 본선/Signal 색상 분리 및 Signal 계산
- OBV 본선/Signal 색상 분리 및 Signal 계산
- MACD multi-output 계약
- SuperTrend main-pane overlay 계약
- DMI +DI/-DI/ADX/강도기준 출력 계약
- 상승 데이터에서 DMI +DI > -DI, ADX > 0
- SMA/RSI/OBV/MACD/SuperTrend/DMI 전부 append/replace 결과와 fresh reset 마지막 결과 parity
- IndicatorHost 실시간 경로가 `calculator.update()` + series `update()`를 사용하는지 확인
- schemaVersion 2, `order`, `paneHeight`, v1→v2 저장 경계
- pane `getHeight`/`setHeight` 및 ↑/↓ 순서 UI 경계
- ChartForm에 지표 계산 하드코딩이 다시 들어오지 않음
- main.ts의 선택적 add-on 등록 경계 유지

`pull_and_verify.ps1`은 tick aggregation test를 실행하고, `addons/chart-indicators/register.ts`가 존재할 때 indicator add-on test도 실행한 뒤 production build를 수행한다.
애드온을 완전히 제거한 구성에서는 indicator test만 자동으로 건너뛴다.
