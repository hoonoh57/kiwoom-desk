# Chart Runtime Diagnostics

## 목적

실제 장중 WebSocket 체결에서 기본 캔들/거래량과 모든 indicator series가 마지막 데이터만 `update()`하는지 화면에서 검증한다.

이 기능은 계산 기능이 아니라 개발용 관찰 add-on이다. 기본 `ChartForm`과 indicator 계산 코드는 진단 add-on을 알지 않는다.

## 물리적 분리

파일:

```text
addons/chart-diagnostics/
  register.ts
  RuntimeDiagnostics.ts
  probe.ts
  diagnostics.css
```

개발 서버(`npm run dev`)에서는 자동 등록한다.
production/preview에서는 URL에 다음 query가 있을 때만 등록한다.

```text
?chartDiag=1
```

완전히 제거하려면 `src/main.ts`의 `../addons/chart-diagnostics/register` dynamic import와 `addons/chart-diagnostics/` 폴더를 제거한다.
기본 `src/chart/extensions.ts`나 `ChartForm`에는 진단 전용 코드가 없다.

## 계측 방식

진단 add-on은 Lightweight Charts `PaneApi.getSeries()`로 현재 series를 찾고 각 series의 실제 `setData()`와 `update()` 호출을 감싼다.
또한 `chart.addSeries()`를 감싸 이후 indicator 추가로 만들어지는 series도 자동 계측한다.

add-on dispose 시 원래 `chart.addSeries`, `series.setData`, `series.update` 메서드를 복원한다.

이 방식은 추정 카운터가 아니라 Lightweight Charts API에 실제 전달된 호출을 센다.

## 사용 순서

1. 차트를 열고 조회 및 indicator 복원이 끝날 때까지 기다린다.
2. 툴바의 `진단` 버튼을 연다.
3. `측정 시작 / 초기화`를 누른다.
4. indicator 추가/삭제, 파라미터 변경, `더보기`, 종목/주기 변경을 하지 않는다.
5. 장중 WebSocket 체결을 일정 시간 받는다.
6. 진단 상태와 카운터를 확인한다.

## PASS 기준

실시간 체결이 하나 이상 들어온 뒤 다음 조건을 모두 만족해야 한다.

```text
bar.replace + bar.append > 0
bars.reset = 0
series.setData = 0
patch 실패 = 0
series.update > 0
```

이 조건이면 badge가 `PASS`가 된다.

`bar.replace`는 현재 진행봉 수정, `bar.append`는 새 봉 생성을 의미한다.

## RESET 판정

측정 중 다음 중 하나라도 발생하면 badge가 `RESET`이 된다.

```text
bars.reset > 0
series.setData > 0
```

이는 측정 구간에 전체 데이터 재설정이 있었다는 뜻이다.

다만 사용자가 의도적으로 다음 작업을 했다면 RESET은 정상이다.

- 종목/주기 변경
- 과거 데이터 `더보기`
- indicator 추가/삭제
- indicator 파라미터 변경
- JSON 지표 구성 적용

따라서 순수 장중 증분 경로를 검증할 때는 먼저 조회와 설정을 끝내고 카운터를 초기화한다.

## series 표

진단 panel의 series 표에는 각 Lightweight Charts series별 실제 호출 횟수가 표시된다.

예:

```text
P0 Candlestick       update=120  setData=0
P1 Histogram         update=120  setData=0
P2 MACD              update=120  setData=0
P2 Signal            update=120  setData=0
P3 RSI               update=120  setData=0
P3 RSI Signal        update=120  setData=0
P4 OBV               update=120  setData=0
P4 OBV Signal        update=120  setData=0
P5 +DI               update=120  setData=0
P5 -DI               update=120  setData=0
P5 ADX               update=120  setData=0
```

SMA처럼 title이 없는 series는 pane/type/순번으로 표시될 수 있다.

## JSON 증거

`JSON` 버튼은 현재 측정값을 textarea에 직렬화한다.
장중 검증 결과를 session handoff나 이슈에 남길 때 이 값을 증거로 사용할 수 있다.

## 자동 테스트

`tests/chartDiagnostics.test.ts`는 다음을 확인한다.

- 기존 series의 `update` 계측
- `setData`와 bars reset 검출
- 진단 설치 이후 새로 생성된 series 자동 계측
- dispose 후 원래 chart/series 메서드 복원
- 진단 add-on이 기본 chart extension 계약과 물리적으로 분리됨

`pull_and_verify.ps1`은 add-on이 설치되어 있으면 `npm run test:diagnostics`를 자동 실행한다.
