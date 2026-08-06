// 사이드바 API 트리 카탈로그
// TR 파라미터 스펙의 단일 소스는 trSchema.ts 이며, 이 파일은 "표시용 구조"만 담당한다.
import {
  TR_SCHEMA, TR_GROUPS, TR_GROUP_ORDER,
  getSpec, buildDefaultBody, validateBody, cleanBody, todayYmd,
  type TrSpec, type TrField, type TrGroup,
} from './trSchema';

/* ---------- 트리 노드 ---------- */
export interface TreeNode {
  label: string;
  icon?: string;
  apiId?: string;
  formId?: string;
  path?: string;
  children?: TreeNode[];
  expanded?: boolean;
}

const GROUP_ICON: Record<string, string> = {
  '종목정보': 'symbol-class',
  '시세': 'pulse',
  '차트': 'graph-line',
  '계좌': 'account',
  '주문': 'credit-card',
  '순위정보': 'list-ordered',
  '기관/외국인': 'organization',
};

/** TR 그룹 → 전용 폼 매핑 (전용 폼이 없으면 trRunner 로 열림) */
const GROUP_FORM: Record<string, string | undefined> = {
  '종목정보': undefined,
  '시세': undefined,
  '차트': undefined,
  '계좌': undefined,
  '주문': undefined,
  '순위정보': undefined,
  '기관/외국인': undefined,
};

/** TR 별 전용 폼 오버라이드 */
const TR_FORM: Record<string, string> = {
  ka10001: 'stockInfo',
  ka10079: 'chart', ka10080: 'chart', ka10081: 'chart',
  ka10082: 'chart', ka10083: 'chart', ka10094: 'chart',
  kt00001: 'account', kt00018: 'account',
  ka10075: 'account', ka10076: 'account', ka10085: 'account',
  kt10000: 'order', kt10001: 'order', kt10002: 'order', kt10003: 'order',
};


export function formIdFor(apiId: string): string {
  if (TR_FORM[apiId]) return TR_FORM[apiId];
  const g = TR_SCHEMA[apiId]?.group;
  return (g && GROUP_FORM[g]) || 'trRunner';
}

/* ---------- 메인 트리 ---------- */
export const API_TREE: TreeNode[] = [
  ...TR_GROUPS.map<TreeNode>((g, i) => ({
    label: g.group,
    icon: GROUP_ICON[g.group] ?? 'folder',
    expanded: i === 0,
    children: g.items.map<TreeNode>(s => ({
      label: s.name,
      apiId: s.id,
      path: s.path,
      formId: formIdFor(s.id),
    })),
  })),
  {
    label: '조건검색 (WebSocket)',
    icon: 'filter',
    children: [
      { label: '조건검색 목록조회', apiId: 'CNSRLST', formId: 'condition' },
      { label: '조건검색 요청 / 실시간등록', apiId: 'CNSRREQ', formId: 'condition' },
      { label: '조건검색 실시간해제', apiId: 'CNSRCLR', formId: 'condition' },
    ],
  },
  {
    label: '작업 화면',
    icon: 'window',
    children: [
      { label: '관심종목', formId: 'watchlist' },
      { label: '자동매매', formId: 'autotrade' },
      { label: '설정', formId: 'settings' },
      { label: '출력', formId: 'output' },
      { label: '로그', formId: 'log' },
    ],
  },
];

/* ---------- 평탄화 / 검색 ---------- */
export interface FlatTr {
  apiId: string;
  name: string;
  group: string;
  path: string;
  formId: string;
}

export const TR_FLAT: FlatTr[] = Object.values(TR_SCHEMA).map(s => ({
  apiId: s.id,
  name: s.name,
  group: s.group,
  path: s.path,
  formId: formIdFor(s.id),
}));

export function searchTr(q: string): FlatTr[] {
  const s = q.trim().toLowerCase();
  if (!s) return TR_FLAT;
  return TR_FLAT.filter(t =>
    t.apiId.toLowerCase().includes(s) ||
    t.name.toLowerCase().includes(s) ||
    t.group.toLowerCase().includes(s) ||
    t.path.toLowerCase().includes(s));
}

/* ---------- 하위호환 export ----------
   예전 코드가 TR_CATALOG / TR_LIST / ENDPOINTS 를 import 하고 있어도 깨지지 않도록 유지 */
export interface CatalogItem {
  id: string;
  apiId: string;
  name: string;
  path: string;
  formId: string;
}
export interface CatalogGroup {
  group: string;
  label: string;
  icon: string;
  items: CatalogItem[];
}

export const TR_CATALOG: CatalogGroup[] = TR_GROUPS.map(g => ({
  group: g.group,
  label: g.group,
  icon: GROUP_ICON[g.group] ?? 'folder',
  items: g.items.map(s => ({
    id: s.id,
    apiId: s.id,
    name: s.name,
    path: s.path,
    formId: formIdFor(s.id),
  })),
}));

export const TR_LIST = TR_FLAT;
export const ENDPOINTS = TR_SCHEMA;

/* ---------- 재수출 ---------- */
export {
  TR_SCHEMA, TR_GROUPS, TR_GROUP_ORDER,
  getSpec, buildDefaultBody, validateBody, cleanBody, todayYmd,
};
export type { TrSpec, TrField, TrGroup };
