# Watchlist Workbench Contract

## 목적

관심종목은 특정 전략의 후보군 저장소가 아니라 Kiwoom Desk의 범용 종목 작업목록이다.
차트, 종목정보, 주문, 조건검색, 향후 AutoTrade 관제에서 같은 종목 목록을 재사용할 수 있어야 한다.

## 1차 완료 범위

- `WatchlistForm` singleton 패널
- 관심종목 그룹 생성/이름변경/삭제/순서 변경
- 그룹 내 종목 추가/삭제/순서 변경
- 종목별 메모
- 서버 로컬 JSON 영속 저장
- revision 기반 다중 탭 stale write 차단
- 행 클릭 시 `Topics.SymbolSelected`
- 행 더블클릭 시 기본 일봉 차트 열기/재사용
- `ka10001` 기반 명시적 시세 새로고침
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

문서 계약:

```json
{
  "schemaVersion": 1,
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
          "addedAt": "2026-08-10T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

PUT는 클라이언트가 읽은 `revision`을 함께 전송한다.
다른 탭이 먼저 저장해 revision이 달라졌으면 HTTP 409와 최신 문서를 반환한다.
클라이언트는 최신 문서를 적용하고 사용자의 변경 재시도를 요구한다.

## 시세 조회 정책

관심종목 패널을 열었다는 이유만으로 종목 수만큼 REST 시세를 자동 fan-out하지 않는다.
이는 Kiwoom API 유량제한과 Workbench 전체 요청 큐를 불필요하게 점유하기 때문이다.

현재 1차 버전:

- 종목 추가 시 이름을 비운 경우 해당 종목 `ka10001` 1회 조회
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

1차 Watchlist에 다음 기능을 넣지 않는다.

- 전략별 자동 후보 선정
- 매수/매도 조건
- 자동주문
- 종목별 지표 계산
- 백테스트
- REST 주기 polling

이 기능들은 Strategy Add-on / AutoTrade runtime / 장중 realtime 계층의 책임이다.

## 검증

`npm run test:watchlist`에서 최소 다음을 검사한다.

- KRX/NXT/통합 코드 정규화
- 동일 그룹 중복 코드 제거
- 빈 문서 기본 그룹 복구
- 저장 revision 증가
- stale revision 저장 차단
- `/api/watchlists` GET/PUT 경로
- `.watchlists.json` Git 제외
- `WatchlistForm` 실제 registry 등록
- 폼 open 시 자동 REST fan-out 금지
- `ka10001` 명시적 quote refresh 사용
