# SESSION HANDOFF — Kiwoom Desk

Date: 2026-08-10
Branch: `main`

## 반드시 먼저 지킬 사항

1. 이 저장소는 **표준/참고용 Kiwoom REST Workbench**다. 특정 전략의 수익률 최적화 프로젝트로 변형하지 않는다.
2. `ChartForm`에 지표/전략 이름이나 계산식을 하드코딩하지 않는다.
3. 지표·전략·진단은 `addons/`의 제거 가능한 기능으로 유지한다.
4. `AutoTradeForm`은 중앙 관제판이며 주문 API를 직접 소유하지 않는다.
5. API Key/Secret/token/PORT는 서버 `.env` 경계에 남기고 Settings/UI/localStorage에 노출하지 않는다.
6. Watchlist는 공통 provenance/candidate 계약으로 확장하며 특정 조건식명을 모델에 하드코딩하지 않는다.
7. REST 자동 반복호출을 새 UI 기능의 편의성 때문에 추가하지 않는다. 유량제한을 항상 고려한다.
8. broker 자동매매는 앱 시작 시 항상 LOCKED여야 한다.
9. 실시간 append/replace, reconnect, soak는 장중 실제 데이터로 검증하기 전까지 완료로 표시하지 않는다.
10. 원격 저장소 코드를 직접 확인/수정한 뒤 로컬에서는 `git pull` + 검증 스크립트로 확인한다.

---

## 현재 완료 상태

### 표준 폼

현재 표준 registry의 모든 항목은 실제 Form 구현이다.

- WelcomeForm
- OutputForm
- LogForm
- StockInfoForm
- TrRunnerForm
- ChartForm
- AccountForm
- OrderForm
- ConditionForm
- WatchlistForm
- AutoTradeForm
- SettingsForm

`PlaceholderForm`은 알 수 없는/확장 formId fallback 용도로만 남아 있다.

### 차트

- 틱/분/일/주/월/년
- NXT/ALL 코드 사용
- 대형 틱봉 합성
- 마지막 봉 증분 update 구조
- chart extension host

### Indicator Add-on

구현/검증된 대표 기능:

- SMA / EMA
- Bollinger Bands
- RSI + signal
- OBV + signal
- MACD
- SuperTrend
- JMA
- DMI / ADX
- Disparity
- Session VWAP + optional bands

지표는 ChartForm에 계산식이 들어가지 않는다.

### Strategy Add-on

프레임워크 완료:

- plugin 등록/발견
- parameters
- JSON 저장/복원/migration
- markers
- signal / paper / broker
- TradeIntent
- broker ARM gate
- portfolio snapshots

`VWAP-JMA Reclaim v3`는 reference/validation sample로 동결한다. 이 저장소에서 전략 성능 최적화를 계속하지 않는다.

### Watchlist

- 그룹/종목 CRUD 및 순서
- 서버 JSON persistence
- revision 충돌
- 명시적 시세 refresh
- chart navigation
- schema v2 provenance (`origins[]`)
- 등록시각/등록가
- 등록대비 수익률 derived column
- 컬럼 표시/정렬 프로퍼티
- view preference와 persistent data 분리
- 재사용 가능한 candidate/upsert 계약

조건식 자동삽입 자체는 base project에 하드코딩하지 않았다.

### Settings

표준 Workbench 설정만 관리:

- 기본 종목
- 레이아웃 복원
- 기본 차트 주기
- 주문 기본 거래소/수량/주문유형
- JSON import/export

서버 비밀값은 포함하지 않는다.

### AutoTrade Monitor

- runtime online/wait
- broker locked/armed
- PAPER/BROKER position/order 상태
- entry/current/P&L/order number
- recent live signals
- account view 연결

관제판은 주문 API를 직접 호출하지 않는다.

---

## 이번 감사에서 보강한 사항

세 chart add-on의 bootstrap 경계를 동일하게 맞췄다.

```text
addons/chart-indicators/register.ts
addons/chart-strategies/register.ts
addons/chart-diagnostics/register.ts
```

모두 `src/main.ts`에서 `import.meta.glob(...)`을 통해 선택적으로 발견한다.
따라서 add-on 폴더가 물리적으로 없더라도 base Workbench production build가 literal import resolve 때문에 깨지지 않아야 한다.

`tests/workbenchAudit.test.ts`를 추가해 다음 회귀를 막는다.

- 표준 Form의 Placeholder 후퇴
- add-on literal import 회귀
- addons가 base tsconfig root로 편입되는 회귀
- AutoTradeForm 직접 주문 API 호출
- Settings secret 노출
- audit/handoff 문서 소실

상세 감사 결과는 `docs/WORKBENCH_AUDIT.md` 참조.

---

## 아직 완료로 표시하면 안 되는 항목

### 장중 실시간 검증

- WebSocket 실제 체결 유입
- 진행봉 replace
- 새 봉 append
- 정상 tick에서 full setData가 발생하지 않는지
- NXT 08:00 세션
- `_AL` 연속성
- 120틱 및 240/360/480/540/720 synthetic tick
- 모든 지표 실시간 증분
- 전략 marker 실시간 증분

### reconnect / soak

- 물리 네트워크 단절
- WS 재연결
- catch-up
- 중복/누락 tick
- 장시간 CPU/memory
- stale/duplicate subscription

### 실제 broker 자동매매

현재 주문/체결 경로는 contract 수준 구현이다. 실제 production-ready로 간주하지 않는다.
통제된 별도 검증이 필요하다.

---

## 다음 세션 작업 순서

### 1. 먼저 로컬 전체 검증

```powershell
Set-Location "E:\2026\opus\typescript\kiwoom-desk"
git pull --ff-only origin main
.\scripts\pull_and_verify.ps1 -SkipPull
```

실패 시 **새 기능을 추가하지 말고 해당 회귀부터 수정**한다.

### 2. AutoTradeForm UI smoke test

- 로켓 아이콘으로 관제판 열기
- Strategy add-on 설치 상태에서 `RUNTIME ONLINE`
- 기본 `BROKER LOCKED`
- 관제판을 열어도 REST 호출 증가 없음
- 계좌현황 버튼 정상
- signal 수신 시 최근 신호 수/목록 갱신

### 3. 표준 기능 개발 동결

위 검증이 통과하면 새 UI/지표/전략을 base project에 계속 추가하지 않는다.

### 4. 장중 검증 트랙

시장 거래시간에만 다음을 순서대로 수행한다.

1. 1분봉 실시간 replace/append
2. 120틱 실시간 replace/append
3. 240/360/480/540/720 합성틱
4. Indicator append/replace diagnostic
5. Strategy marker append/replace diagnostic
6. NXT 08:00 / `_AL`
7. WS 물리 reconnect
8. 장시간 soak

검증 실패는 `kiwoom-desk` framework defect로 고친다.
전략의 수익성/진입/청산 개선은 다른 프로젝트에서 진행한다.

---

## 완료 판단

현재는 **Standard Workbench feature-complete / live-validation-pending** 상태로 본다.

즉 표준 기능 구조는 1차 완료했지만, 장중 WebSocket/reconnect/soak와 실제 broker execution은 아직 production 완료가 아니다.
