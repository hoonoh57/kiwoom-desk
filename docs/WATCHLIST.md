# Watchlist Workbench Contract

## 목적

관심종목은 특정 전략의 후보군 저장소가 아니라 Kiwoom Desk의 범용 종목 작업목록이다.
차트, 종목정보, 주문, 조건검색, 향후 AutoTrade 관제에서 같은 종목 목록을 재사용할 수 있어야 한다.

이 저장소는 표준 Kiwoom REST Workbench이므로 Watchlist도 특정 조건식/전략 이름을 하드코딩하지 않는다.
다른 프로젝트가 데이터 계약과 삽입 포트만 재사용할 수 있도록 저장 모델, mutation, view를 분리한다.

```text
src/watchlists/model.ts       영속 schema / migration
src/watchlists/mutations.ts   후보 삽입/upsert 표준 포트
src/watchlists/view.ts        컬럼 catalog / 화면 정렬
src/forms/WatchlistForm.ts    Workbench UI
```

## 현재 완료 범위

- `WatchlistForm` singleton 패널
- 관심종목 그룹 생성/이름변경/삭제/순서 변경
- 그룹 내 종목 추가/삭제/수동 순서 변경
- 종목별 메모
- 서버 로컬 JSON 영속 저장
- revision 기반 다중 탭 stale write 차단
- 행 클릭 시 `Topics.SymbolSelected`
- 행 더블클릭 시 기본 일봉 차트 열기/재사용
- `ka10001` 기반 명시적 시세 새로고침
- 수동 등록시각/등록가 보존
- provenance `origins[]`
- 등록가 대비 현재 수익률 derived column
- Column Catalog 기반 표시/숨김
- 화면 정렬과 저장 수동순서 분리
- View 설정 localStorage 저장
- Activity Bar 별 아이콘 / 조회 메뉴 / 명령 팔레트에서 접근

## 저장 경계

브라우저 localStorage를 관심종목 데이터의 원본으로 사용하지 않는다.
로컬 API 서버의 `/api/watchlists`가 문서 원본이다.

```text
GET /api/watchlists
PUT /api/watchlists
```

서버 저장 파일:

```text
.watchlists.json
```

이 파일은 사용자별 로컬 런타임 데이터이며 Git에 커밋하지 않는다.

## schema v2

```json
{
  "schemaVersion": 2,
  "revision": 3,
  "groups": [
    {
      "id": "default",
      "name": "기본",
      "order": 0,
      "items": [
        {
          "code": "005930_AL",
          "name": "삼성전자",
          "note": "장초반 관찰",
          "order": 0,
          "addedAt": "2026-08-10T00:05:00.000Z",
          "addedPrice": 70000,
          "origins": [
            {
              "type": "condition",
              "key": "1516",
              "label": "1516",
              "capturedAt": "2026-08-10T00:05:00.000Z",
              "capturedPrice": 70000
            },
            {
              "type": "ranking",
              "key": "ka10027",
              "label": "전일대비등락률 상위",
              "capturedAt": "2026-08-10T00:07:00.000Z",
              "capturedPrice": 70600
            }
          ]
        }
      ]
    }
  ]
}
```

### `addedAt` / `addedPrice`

이 값은 **해당 Watchlist item의 첫 등록 기준**이다.
같은 종목이 나중에 다른 조건식에서 다시 잡혀도 덮어쓰지 않는다.

등록대비 수익률은 저장하지 않는다.

```text
(currentPrice / addedPrice - 1) * 100
```

으로 화면에서 계산한다. 현재가 변화 때문에 Watchlist 문서를 계속 다시 저장하지 않기 위함이다.

### `origins[]`

한 종목은 여러 경로에서 유입될 수 있으므로 단일 `source` 문자열을 쓰지 않는다.

지원 source type:

- `manual`
- `condition`
- `ranking`
- `strategy`
- `import`

동일 `type + key`가 반복 유입되면 origin 배열을 무한히 늘리지 않고 해당 source의 최신 `capturedAt/capturedPrice`로 갱신한다.
서로 다른 source는 함께 보존한다.

Watchlist는 모든 포착 이벤트의 장기 로그가 아니다.
모든 조건식 신호/성과 이벤트는 별도 performance/signal log가 책임지고,
Watchlist는 **현재 작업목록 + provenance**만 유지한다.

### v1 migration

기존 schema v1은 로드시 자동으로 v2로 정규화한다.
기존 항목에 source 정보가 없으면 `manual/수동` provenance를 생성한다.
따라서 기존 `.watchlists.json`을 수동 변환할 필요가 없다.

## 외부 후보 삽입 표준 포트

조건검색/랭킹/전략 Form이 `WatchlistForm` 인스턴스를 직접 참조하지 않는다.
다른 프로젝트는 후보를 중립 `WatchlistCandidate`로 변환한 뒤 공통 mutation을 사용한다.

```ts
import { upsertWatchlistCandidate } from './watchlists/mutations';

const result = upsertWatchlistCandidate(groups, groupId, {
  code: '174900',
  name: '앱클론',
  capturedAt: new Date().toISOString(),
  capturedPrice: 28300,
  source: {
    type: 'condition',
    key: '1516',
    label: '1516',
  },
});
```

그 뒤 저장 서비스가 `result.groups`를 revision contract로 저장한다.
이 mutation은 조건식 이름, 랭킹 API, 전략 이름을 알지 못한다.

향후 자동 조건검색 삽입도 이 계약을 사용하며 WatchlistForm UI 코드를 호출하지 않는다.

## 화면 View 계약

화면 컬럼은 데이터 schema가 아니라 `src/watchlists/view.ts`의 Column Catalog가 정의한다.
현재 표준 컬럼은 다음을 포함한다.

```text
#
코드
종목명
현재가
등락
등락률%
거래량
등록일시
등록가
등록대비%
소스
소스시각
메모
순서/삭제
```

`표시/정렬` 프로퍼티 패널에서 컬럼별 표시/숨김과 정렬을 선택한다.

View 설정은 서버 Watchlist revision과 분리하여:

```text
localStorage: kiwoom-desk.watchlist.view.v1
```

에 저장한다.

따라서 컬럼을 숨기거나 정렬을 바꾸는 작업 때문에 `.watchlists.json` revision 충돌이 발생하지 않는다.

### 정렬과 수동순서

기본은 저장된 `item.order` 수동 순서다.

사용자는 현재가/등락률/등록일시/등록가/등록대비%/소스 등으로 화면 정렬할 수 있다.
화면 정렬은 배열의 `order`를 절대 변경하지 않는다.
정렬을 다시 `수동 순서`로 바꾸면 원래 순서가 복원된다.

화면 정렬 중에는 ↑/↓ 수동 순서 버튼을 잠가 의미 혼동을 막는다.

## 시세 조회 정책

관심종목 패널을 열었다는 이유만으로 종목 수만큼 REST 시세를 자동 fan-out하지 않는다.
이는 Kiwoom API 유량제한과 Workbench 전체 요청 큐를 불필요하게 점유하기 때문이다.

현재 버전:

- 수동 종목 추가 시 `ka10001` 1회로 종목명과 **등록가**를 함께 확보
- 조회 실패해도 종목 등록은 허용하고 `addedPrice`만 비워 둠
- `시세 새로고침` 버튼을 눌렀을 때 현재 그룹을 순차 조회
- KiwoomClient 중앙 rate-limit queue를 그대로 사용

장중 실시간 시세는 별도 검증 트랙에서 WebSocket 등록/해제/재연결/soak까지 검증한 뒤 추가한다.

## 종목 선택 계약

행 클릭:

```text
Topics.SymbolSelected
  code
  name
```

을 발행한다. 기존 차트/종목정보 등은 이 중립 이벤트를 재사용할 수 있다.

행 더블클릭:

```text
chart + ka10081 + selected code
```

를 DockService로 열어 기본 일봉 차트를 보여준다.
차트 인스턴스 정책은 기존 DockService가 담당하며 WatchlistForm이 panel key를 별도로 만들지 않는다.

## 비범위

표준 Watchlist에 다음 기능을 넣지 않는다.

- 특정 조건식 이름 하드코딩
- 전략별 매수/매도 조건
- 자동주문
- 종목별 지표 계산
- 백테스트
- REST 주기 polling
- 모든 조건식 hit의 장기 event log

이 기능들은 Condition/Strategy Add-on/AutoTrade/performance log/장중 realtime 계층의 책임이다.

## 검증

`npm run test:watchlist`에서 최소 다음을 검사한다.

- KRX/NXT/통합 코드 정규화
- schema v1 -> v2 migration
- 동일 그룹 중복 코드 제거
- 다중 source provenance merge
- 같은 source 재유입 시 최신 origin 갱신
- 첫 `addedAt/addedPrice` 보존
- 등록대비 수익률 derived 계산
- 화면 정렬이 수동 `order`를 변경하지 않음
- 빈 문서 기본 그룹 복구
- 저장 revision 증가
- stale revision 저장 차단
- `/api/watchlists` GET/PUT 경로
- `.watchlists.json` Git 제외
- `WatchlistForm` 실제 registry 등록
- 폼 open 시 자동 REST fan-out 금지
- `ka10001` 명시적 quote refresh/등록가 조회
- View 설정과 서버 data 분리
