// TR 파라미터 스키마 — 키움 REST API 요청 Body 정의
// 사이드바 트리 / TR Runner / 각 child form 이 모두 이 파일을 단일 소스로 사용

export type FieldKind = 'text' | 'number' | 'select' | 'date' | 'symbol';

export interface TrField {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  def?: string;                          // 기본값
  options?: { v: string; t: string }[];  // select 용
  maxLength?: number;
  placeholder?: string;
  help?: string;
}

export interface TrSpec {
  id: string;
  name: string;
  path: string;
  group: string;
  fields: TrField[];
  cont?: boolean;    // 연속조회 지원
  danger?: boolean;  // 실주문 등 확인 필요
  listKey?: string;  // 응답 배열 키 (표 렌더용)
}

/* ---------- 공용 옵션 ---------- */
const YN01 = [{ v: '0', t: '0:미포함' }, { v: '1', t: '1:포함' }];
const UPD = [{ v: '0', t: '0:수정주가 미반영' }, { v: '1', t: '1:수정주가 반영' }];
const STEX = [{ v: '0', t: '0:통합' }, { v: '1', t: '1:KRX' }, { v: '2', t: '2:NXT' }];
const STEX_RANK = [{ v: '1', t: '1:KRX' }, { v: '2', t: '2:NXT' }, { v: '3', t: '3:통합' }];
const MRKT3 = [
  { v: '000', t: '000:전체' },
  { v: '001', t: '001:코스피' },
  { v: '101', t: '101:코스닥' },
];
const TRDE_QTY = [
  { v: '0000', t: '0000:전체조회' }, { v: '0010', t: '0010:만주이상' },
  { v: '0050', t: '0050:5만주이상' }, { v: '0100', t: '0100:10만주이상' },
  { v: '0150', t: '0150:15만주이상' }, { v: '0200', t: '0200:20만주이상' },
  { v: '0300', t: '0300:30만주이상' }, { v: '0500', t: '0500:50만주이상' },
  { v: '1000', t: '1000:백만주이상' },
];
const STK_CND = [
  { v: '0', t: '0:전체조회' }, { v: '1', t: '1:관리종목제외' },
  { v: '3', t: '3:우선주제외' }, { v: '4', t: '4:관리+우선주제외' },
  { v: '5', t: '5:증100제외' }, { v: '6', t: '6:증100만' },
  { v: '7', t: '7:증40만' }, { v: '8', t: '8:증30만' }, { v: '9', t: '9:증20만' },
];
const CRD_CND = [
  { v: '0', t: '0:전체조회' }, { v: '1', t: '1:신용융자A군' },
  { v: '2', t: '2:신용융자B군' }, { v: '3', t: '3:신용융자C군' },
  { v: '4', t: '4:신용융자D군' }, { v: '9', t: '9:신용融자전체' },
];
const PRIC_CND = [
  { v: '0', t: '0:전체조회' }, { v: '1', t: '1:1천원미만' },
  { v: '2', t: '2:1천~2천원' }, { v: '3', t: '3:1천~5천원' },
  { v: '4', t: '4:5천~1만원' }, { v: '5', t: '5:1만원이상' },
  { v: '8', t: '8:1천원이상' }, { v: '9', t: '9:5천원이상' },
];
const TRDE_PRICA = [
  { v: '0', t: '0:전체조회' }, { v: '3', t: '3:3천만원이상' },
  { v: '5', t: '5:5천만원이상' }, { v: '10', t: '10:1억원이상' },
  { v: '30', t: '30:3억원이상' }, { v: '50', t: '50:5억원이상' },
  { v: '100', t: '100:10억원이상' }, { v: '300', t: '300:30억원이상' },
  { v: '500', t: '500:50억원이상' }, { v: '1000', t: '1000:100억원이상' },
];
const DMST_STEX = [
  { v: 'KRX', t: 'KRX' }, { v: 'NXT', t: 'NXT' }, { v: 'SOR', t: 'SOR(최선주문집행)' },
];
const TRDE_TP = [
  { v: '0', t: '0:보통(지정가)' }, { v: '3', t: '3:시장가' },
  { v: '5', t: '5:조건부지정가' }, { v: '6', t: '6:최유리지정가' },
  { v: '7', t: '7:최우선지정가' }, { v: '10', t: '10:보통(IOC)' },
  { v: '13', t: '13:시장가(IOC)' }, { v: '20', t: '20:보통(FOK)' },
  { v: '23', t: '23:시장가(FOK)' }, { v: '61', t: '61:장시작전시간외' },
  { v: '62', t: '62:시간외단일가' }, { v: '81', t: '81:장마감후시간외' },
];

/* ---------- 헬퍼 ---------- */
export function todayYmd(): string {
  const kst = new Date(Date.now() + 9 * 3600_000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

const sym = (req = true): TrField => ({
  key: 'stk_cd', label: '종목코드', kind: 'symbol', required: req,
  def: '005930', maxLength: 20, placeholder: '005930 / 005930_NX / 005930_AL',
  help: 'KRX:005930, NXT:005930_NX, SOR:005930_AL',
});
const dt = (key: string, label: string, req = true): TrField =>
  ({ key, label, kind: 'date', required: req, def: todayYmd(), maxLength: 8, placeholder: 'YYYYMMDD' });
const sel = (key: string, label: string, options: { v: string; t: string }[], def: string, req = true): TrField =>
  ({ key, label, kind: 'select', required: req, def, options });

/* ---------- TR 스키마 ---------- */
export const TR_SCHEMA: Record<string, TrSpec> = {
  /* === 종목정보 /api/dostk/stkinfo === */
  ka10001: { id: 'ka10001', name: '주식기본정보요청', path: '/api/dostk/stkinfo', group: '종목정보', fields: [sym()] },
  ka10002: { id: 'ka10002', name: '주식거래원요청', path: '/api/dostk/stkinfo', group: '종목정보', fields: [sym()] },
  ka10003: { id: 'ka10003', name: '체결정보요청', path: '/api/dostk/stkinfo', group: '종목정보', fields: [sym()], listKey: 'cntr_infr' },
  ka10015: {
    id: 'ka10015', name: '일별거래상세요청', path: '/api/dostk/stkinfo', group: '종목정보',
    cont: true, listKey: 'daly_trde_dtl',
    fields: [sym(), dt('strt_dt', '시작일자')],
  },
  ka10095: {
    id: 'ka10095', name: '관심종목정보요청', path: '/api/dostk/stkinfo', group: '종목정보',
    listKey: 'atn_stk_infr',
    fields: [{ ...sym(), label: '종목코드(다건 |)', placeholder: '005930|000660|035720', help: '여러 종목은 | 로 구분' }],
  },
  ka10099: {
    id: 'ka10099', name: '종목정보 리스트', path: '/api/dostk/stkinfo', group: '종목정보',
    cont: true, listKey: 'list',
    fields: [sel('mrkt_tp', '시장구분', [
      { v: '0', t: '0:코스피' }, { v: '10', t: '10:코스닥' }, { v: '3', t: '3:ELW' },
      { v: '8', t: '8:ETF' }, { v: '30', t: '30:K-OTC' }, { v: '50', t: '50:코넥스' },
      { v: '5', t: '5:신주인수권' }, { v: '4', t: '4:뮤추얼펀드' },
      { v: '6', t: '6:리츠' }, { v: '9', t: '9:하이일드' },
    ], '0')],
  },
  ka10100: { id: 'ka10100', name: '종목정보 조회', path: '/api/dostk/stkinfo', group: '종목정보', fields: [sym()] },
  ka10101: {
    id: 'ka10101', name: '업종코드 리스트', path: '/api/dostk/stkinfo', group: '종목정보', listKey: 'list',
    fields: [sel('mrkt_tp', '시장구분', [
      { v: '0', t: '0:코스피(0~7)' }, { v: '1', t: '1:코스닥(101~105)' },
      { v: '2', t: '2:KOSPI200(201~212)' }, { v: '4', t: '4:KOSPI100' }, { v: '7', t: '7:KRX100' },
    ], '0')],
  },
  ka10102: { id: 'ka10102', name: '회원사 리스트', path: '/api/dostk/stkinfo', group: '종목정보', listKey: 'list', fields: [] },
  ka00198: {
    id: 'ka00198', name: '실시간종목조회순위', path: '/api/dostk/stkinfo', group: '종목정보', listKey: 'item_inq_rank',
    fields: [sel('qry_tp', '구분', [
      { v: '1', t: '1:1분' }, { v: '2', t: '2:10분' }, { v: '3', t: '3:1시간' },
      { v: '4', t: '4:당일누적' }, { v: '5', t: '5:30초' },
    ], '4')],
  },

  /* === 시세 /api/dostk/mrkcond === */
  ka10004: { id: 'ka10004', name: '주식호가요청', path: '/api/dostk/mrkcond', group: '시세', fields: [sym()] },
  ka10005: { id: 'ka10005', name: '주식일주월시분요청', path: '/api/dostk/mrkcond', group: '시세', fields: [sym()], listKey: 'stk_ddwkmm' },
  ka10006: { id: 'ka10006', name: '주식시분요청', path: '/api/dostk/mrkcond', group: '시세', fields: [sym()] },
  ka10007: { id: 'ka10007', name: '시세표성정보요청', path: '/api/dostk/mrkcond', group: '시세', fields: [sym()] },
  ka10086: {
    id: 'ka10086', name: '일별주가요청', path: '/api/dostk/mrkcond', group: '시세',
    cont: true, listKey: 'daly_stkpc',
    fields: [
      sym(),
      dt('qry_dt', '조회일자'),
      sel('indc_tp', '표시구분', [{ v: '0', t: '0:수량' }, { v: '1', t: '1:금액(백만원)' }], '0'),
    ],
  },

  /* === 차트 /api/dostk/chart === */
  ka10079: {
    id: 'ka10079', name: '주식틱차트조회요청', path: '/api/dostk/chart', group: '차트',
    cont: true, listKey: 'stk_tic_chart_qry',
    fields: [
      sym(),
      sel('tic_scope', '틱범위', [
        { v: '1', t: '1틱' }, { v: '3', t: '3틱' }, { v: '5', t: '5틱' },
        { v: '10', t: '10틱' }, { v: '30', t: '30틱' },
      ], '1'),
      sel('upd_stkpc_tp', '수정주가구분', UPD, '1'),
    ],
  },
  ka10080: {
    id: 'ka10080', name: '주식분봉차트조회요청', path: '/api/dostk/chart', group: '차트',
    cont: true, listKey: 'stk_min_pole_chart_qry',
    fields: [
      sym(),
      sel('tic_scope', '분범위', [
        { v: '1', t: '1분' }, { v: '3', t: '3분' }, { v: '5', t: '5분' }, { v: '10', t: '10분' },
        { v: '15', t: '15분' }, { v: '30', t: '30분' }, { v: '45', t: '45분' }, { v: '60', t: '60분' },
      ], '5'),
      sel('upd_stkpc_tp', '수정주가구분', UPD, '1'),
    ],
  },
  ka10081: {
    id: 'ka10081', name: '주식일봉차트조회요청', path: '/api/dostk/chart', group: '차트',
    cont: true, listKey: 'stk_dt_pole_chart_qry',
    fields: [sym(), dt('base_dt', '기준일자'), sel('upd_stkpc_tp', '수정주가구분', UPD, '1')],
  },
  ka10082: {
    id: 'ka10082', name: '주식주봉차트조회요청', path: '/api/dostk/chart', group: '차트',
    cont: true, listKey: 'stk_stk_pole_chart_qry',
    fields: [sym(), dt('base_dt', '기준일자'), sel('upd_stkpc_tp', '수정주가구분', UPD, '1')],
  },
  ka10083: {
    id: 'ka10083', name: '주식월봉차트조회요청', path: '/api/dostk/chart', group: '차트',
    cont: true, listKey: 'stk_mth_pole_chart_qry',
    fields: [sym(), dt('base_dt', '기준일자'), sel('upd_stkpc_tp', '수정주가구분', UPD, '1')],
  },
  ka10094: {
    id: 'ka10094', name: '주식년봉차트조회요청', path: '/api/dostk/chart', group: '차트',
    cont: true, listKey: 'stk_yr_pole_chart_qry',
    fields: [sym(), dt('base_dt', '기준일자'), sel('upd_stkpc_tp', '수정주가구분', UPD, '1')],
  },

  /* === 계좌 /api/dostk/acnt === */
  kt00001: {
    id: 'kt00001', name: '예수금상세현황요청', path: '/api/dostk/acnt', group: '계좌',
    fields: [sel('qry_tp', '조회구분', [{ v: '3', t: '3:추정조회' }, { v: '2', t: '2:일반조회' }], '3')],
  },
  kt00018: {
    id: 'kt00018', name: '계좌평가잔고내역요청', path: '/api/dostk/acnt', group: '계좌',
    cont: true, listKey: 'acnt_evlt_remn_indv_tot',
    fields: [
      sel('qry_tp', '조회구분', [{ v: '1', t: '1:합산' }, { v: '2', t: '2:개별' }], '1'),
      sel('dmst_stex_tp', '국내거래소구분', [{ v: 'KRX', t: 'KRX' }, { v: 'NXT', t: 'NXT' }], 'KRX'),
    ],
  },
  ka10075: {
    id: 'ka10075', name: '미체결요청', path: '/api/dostk/acnt', group: '계좌',
    cont: true, listKey: 'oso',
    fields: [
      sel('all_stk_tp', '전체종목구분', [{ v: '0', t: '0:전체' }, { v: '1', t: '1:종목' }], '0'),
      sel('trde_tp', '매매구분', [{ v: '0', t: '0:전체' }, { v: '1', t: '1:매도' }, { v: '2', t: '2:매수' }], '0'),
      { ...sym(false), label: '종목코드(선택)', def: '' },
      sel('stex_tp', '거래소구분', STEX, '0'),
    ],
  },
  ka10076: {
    id: 'ka10076', name: '체결요청', path: '/api/dostk/acnt', group: '계좌',
    cont: true, listKey: 'cntr',
    fields: [
      { ...sym(false), label: '종목코드(선택)', def: '' },
      sel('qry_tp', '조회구분', [{ v: '0', t: '0:전체' }, { v: '1', t: '1:종목' }], '0'),
      sel('sell_tp', '매도수구분', [{ v: '0', t: '0:전체' }, { v: '1', t: '1:매도' }, { v: '2', t: '2:매수' }], '0'),
      { key: 'ord_no', label: '주문번호(선택)', kind: 'text', required: false, def: '', maxLength: 10, help: '입력시 이전 주문 조회' },
      sel('stex_tp', '거래소구분', STEX, '0'),
    ],
  },
  ka10085: {
    id: 'ka10085', name: '계좌수익률요청', path: '/api/dostk/acnt', group: '계좌',
    listKey: 'acnt_prft_rt',
    fields: [sel('stex_tp', '거래소구분', STEX, '0')],
  },

  /* === 주문 /api/dostk/ordr === */
  kt10000: {
    id: 'kt10000', name: '주식 매수주문', path: '/api/dostk/ordr', group: '주문', danger: true,
    fields: [
      sel('dmst_stex_tp', '국내거래소구분', DMST_STEX, 'KRX'),
      sym(),
      { key: 'ord_qty', label: '주문수량', kind: 'number', required: true, def: '1', maxLength: 12 },
      { key: 'ord_uv', label: '주문단가', kind: 'number', required: false, def: '', maxLength: 12, help: '시장가는 공란' },
      sel('trde_tp', '매매구분', TRDE_TP, '3'),
      { key: 'cond_uv', label: '조건단가', kind: 'number', required: false, def: '', maxLength: 12 },
    ],
  },
  kt10001: {
    id: 'kt10001', name: '주식 매도주문', path: '/api/dostk/ordr', group: '주문', danger: true,
    fields: [
      sel('dmst_stex_tp', '국내거래소구분', DMST_STEX, 'KRX'),
      sym(),
      { key: 'ord_qty', label: '주문수량', kind: 'number', required: true, def: '1', maxLength: 12 },
      { key: 'ord_uv', label: '주문단가', kind: 'number', required: false, def: '', maxLength: 12, help: '시장가는 공란' },
      sel('trde_tp', '매매구분', TRDE_TP, '3'),
      { key: 'cond_uv', label: '조건단가', kind: 'number', required: false, def: '', maxLength: 12 },
    ],
  },
  kt10002: {
    id: 'kt10002', name: '주식 정정주문', path: '/api/dostk/ordr', group: '주문', danger: true,
    fields: [
      sel('dmst_stex_tp', '국내거래소구분', DMST_STEX, 'KRX'),
      { key: 'orig_ord_no', label: '원주문번호', kind: 'text', required: true, def: '', maxLength: 7 },
      sym(),
      { key: 'mdfy_qty', label: '정정수량', kind: 'number', required: true, def: '1', maxLength: 12 },
      { key: 'mdfy_uv', label: '정정단가', kind: 'number', required: true, def: '', maxLength: 12 },
      { key: 'mdfy_cond_uv', label: '정정조건단가', kind: 'number', required: false, def: '', maxLength: 12 },
    ],
  },
  kt10003: {
    id: 'kt10003', name: '주식 취소주문', path: '/api/dostk/ordr', group: '주문', danger: true,
    fields: [
      sel('dmst_stex_tp', '국내거래소구분', DMST_STEX, 'KRX'),
      { key: 'orig_ord_no', label: '원주문번호', kind: 'text', required: true, def: '', maxLength: 7 },
      sym(),
      { key: 'cncl_qty', label: '취소수량', kind: 'text', required: true, def: '0', maxLength: 12, help: '0 입력시 잔량 전부 취소' },
    ],
  },

  /* === 순위정보 /api/dostk/rkinfo === */
  ka10027: {
    id: 'ka10027', name: '전일대비등락률상위요청', path: '/api/dostk/rkinfo', group: '순위정보',
    cont: true, listKey: 'pred_pre_flu_rt_upper',
    fields: [
      sel('mrkt_tp', '시장구분', MRKT3, '000'),
      sel('sort_tp', '정렬구분', [
        { v: '1', t: '1:상승률' }, { v: '2', t: '2:상승폭' },
        { v: '3', t: '3:하락률' }, { v: '4', t: '4:하락폭' }, { v: '5', t: '5:보합' },
      ], '1'),
      sel('trde_qty_cnd', '거래량조건', TRDE_QTY, '0000'),
      sel('stk_cnd', '종목조건', STK_CND, '0'),
      sel('crd_cnd', '신용조건', CRD_CND, '0'),
      sel('updown_incls', '상하한포함', [{ v: '0', t: '0:불포함' }, { v: '1', t: '1:포함' }], '1'),
      sel('pric_cnd', '가격조건', PRIC_CND, '0'),
      sel('trde_prica_cnd', '거래대금조건', TRDE_PRICA, '0'),
      sel('stex_tp', '거래소구분', STEX_RANK, '3'),
    ],
  },
  ka10032: {
    id: 'ka10032', name: '거래대금상위요청', path: '/api/dostk/rkinfo', group: '순위정보',
    cont: true, listKey: 'trde_prica_upper',
    fields: [
      sel('mrkt_tp', '시장구분', MRKT3, '000'),
      sel('mang_stk_incls', '관리종목포함', YN01, '0'),
      sel('stex_tp', '거래소구분', STEX_RANK, '3'),
    ],
  },
  ka10020: {
    id: 'ka10020', name: '호가잔량상위요청', path: '/api/dostk/rkinfo', group: '순위정보',
    cont: true, listKey: 'bid_req_upper',
    fields: [
      sel('mrkt_tp', '시장구분', [{ v: '001', t: '001:코스피' }, { v: '101', t: '101:코스닥' }], '001'),
      sel('sort_tp', '정렬구분', [
        { v: '1', t: '1:순매수잔량순' }, { v: '2', t: '2:순매도잔량순' },
        { v: '3', t: '3:매수비율순' }, { v: '4', t: '4:매도비율순' },
      ], '1'),
      sel('trde_qty_tp', '거래량구분', TRDE_QTY, '0000'),
      sel('stk_cnd', '종목조건', STK_CND, '0'),
      sel('crd_cnd', '신용조건', CRD_CND, '0'),
      sel('stex_tp', '거래소구분', STEX_RANK, '3'),
    ],
  },

  /* === 기관/외국인 /api/dostk/frgnistt === */
  ka10008: {
    id: 'ka10008', name: '주식외국인종목별매매동향', path: '/api/dostk/frgnistt', group: '기관/외국인',
    cont: true, listKey: 'stk_frgnr', fields: [sym()],
  },
};

/* ---------- 파생 구조 ---------- */
export const TR_GROUP_ORDER = [
  '종목정보', '시세', '차트', '계좌', '주문', '순위정보', '기관/외국인',
];

export interface TrGroup { group: string; items: TrSpec[]; }

export const TR_GROUPS: TrGroup[] = TR_GROUP_ORDER.map(g => ({
  group: g,
  items: Object.values(TR_SCHEMA).filter(s => s.group === g),
})).filter(g => g.items.length > 0);

export function getSpec(apiId: string): TrSpec | undefined {
  return TR_SCHEMA[apiId];
}

/** 스키마 기본값으로 요청 Body 생성 (ctxSymbol 이 있으면 stk_cd 대체) */
export function buildDefaultBody(spec: TrSpec, ctxSymbol?: string): Record<string, string> {
  const body: Record<string, string> = {};
  for (const f of spec.fields) {
    let v = f.def ?? '';
    if (f.kind === 'symbol' && ctxSymbol && f.required) v = ctxSymbol;
    if (f.kind === 'date' && !v) v = todayYmd();
    body[f.key] = v;
  }
  return body;
}

/** 전송 전 필수값 검증 — 누락 필드 label 배열 반환 */
export function validateBody(spec: TrSpec, body: Record<string, any>): string[] {
  const miss: string[] = [];
  for (const f of spec.fields) {
    if (!f.required) continue;
    const v = body[f.key];
    if (v === undefined || v === null || String(v).trim() === '') miss.push(`${f.label}(${f.key})`);
  }
  return miss;
}

/** 빈 문자열 선택 필드는 요청에서 제거 (키움은 빈값 허용하나 정리 목적) */
export function cleanBody(spec: TrSpec, body: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = body[f.key];
    if (!f.required && (v === undefined || String(v).trim() === '')) continue;
    out[f.key] = String(v ?? '');
  }
  return out;
}
