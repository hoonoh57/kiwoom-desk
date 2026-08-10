import type { WatchlistItem, WatchlistOrigin } from './model';

export type WatchlistColumnId =
  | 'row'
  | 'code'
  | 'name'
  | 'currentPrice'
  | 'change'
  | 'changeRate'
  | 'volume'
  | 'addedAt'
  | 'addedPrice'
  | 'returnSinceAddedPct'
  | 'source'
  | 'sourceCapturedAt'
  | 'note'
  | 'actions';

export interface WatchlistColumnDef {
  id: WatchlistColumnId;
  label: string;
  defaultVisible: boolean;
  sortable: boolean;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

export interface WatchlistQuoteView {
  price: number;
  change: number;
  rate: number;
  volume: number;
}

export type WatchlistSortDirection = 'asc' | 'desc';

export interface WatchlistSortSpec {
  column: WatchlistColumnId;
  direction: WatchlistSortDirection;
}

export interface WatchlistViewConfig {
  version: 1;
  visibleColumns: WatchlistColumnId[];
  sort: WatchlistSortSpec | null;
}

export const WATCHLIST_COLUMNS: readonly WatchlistColumnDef[] = [
  { id: 'row', label: '#', defaultVisible: true, sortable: false, width: 44, align: 'center' },
  { id: 'code', label: '코드', defaultVisible: true, sortable: true, width: 96, align: 'center' },
  { id: 'name', label: '종목명', defaultVisible: true, sortable: true, width: 120, align: 'left' },
  { id: 'currentPrice', label: '현재가', defaultVisible: true, sortable: true, width: 92, align: 'right' },
  { id: 'change', label: '등락', defaultVisible: false, sortable: true, width: 82, align: 'right' },
  { id: 'changeRate', label: '등락률%', defaultVisible: true, sortable: true, width: 82, align: 'right' },
  { id: 'volume', label: '거래량', defaultVisible: false, sortable: true, width: 110, align: 'right' },
  { id: 'addedAt', label: '등록일시', defaultVisible: true, sortable: true, width: 128, align: 'center' },
  { id: 'addedPrice', label: '등록가', defaultVisible: true, sortable: true, width: 92, align: 'right' },
  { id: 'returnSinceAddedPct', label: '등록대비%', defaultVisible: true, sortable: true, width: 90, align: 'right' },
  { id: 'source', label: '소스', defaultVisible: true, sortable: true, width: 130, align: 'left' },
  { id: 'sourceCapturedAt', label: '소스시각', defaultVisible: false, sortable: true, width: 128, align: 'center' },
  { id: 'note', label: '메모', defaultVisible: true, sortable: false, width: 180, align: 'left' },
  { id: 'actions', label: '순서/삭제', defaultVisible: true, sortable: false, width: 94, align: 'center' },
] as const;

const COLUMN_IDS = new Set<WatchlistColumnId>(WATCHLIST_COLUMNS.map(column => column.id));
const SORTABLE = new Set<WatchlistColumnId>(WATCHLIST_COLUMNS.filter(column => column.sortable).map(column => column.id));

export function defaultWatchlistViewConfig(): WatchlistViewConfig {
  return {
    version: 1,
    visibleColumns: WATCHLIST_COLUMNS.filter(column => column.defaultVisible).map(column => column.id),
    sort: null,
  };
}

export function normalizeWatchlistViewConfig(value: unknown): WatchlistViewConfig {
  const fallback = defaultWatchlistViewConfig();
  if (!value || typeof value !== 'object') return fallback;
  const row = value as Partial<WatchlistViewConfig>;
  const visible = Array.isArray(row.visibleColumns)
    ? row.visibleColumns.filter((id): id is WatchlistColumnId => COLUMN_IDS.has(id as WatchlistColumnId))
    : fallback.visibleColumns;
  const visibleColumns = Array.from(new Set(visible.length ? visible : fallback.visibleColumns));
  const rawSort = row.sort as Partial<WatchlistSortSpec> | null | undefined;
  const sort = rawSort
    && SORTABLE.has(rawSort.column as WatchlistColumnId)
    && (rawSort.direction === 'asc' || rawSort.direction === 'desc')
      ? { column: rawSort.column as WatchlistColumnId, direction: rawSort.direction }
      : null;
  return { version: 1, visibleColumns, sort };
}

export function latestWatchlistOrigin(item: WatchlistItem): WatchlistOrigin | undefined {
  return [...item.origins].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
}

export function watchlistOriginLabel(origin: WatchlistOrigin | undefined): string {
  if (!origin) return '';
  const prefix = origin.type === 'manual'
    ? '수동'
    : origin.type === 'condition'
      ? '조건식'
      : origin.type === 'ranking'
        ? '랭킹'
        : origin.type === 'strategy'
          ? '전략'
          : '가져오기';
  const label = origin.label || origin.key;
  if (!label || label === prefix) return prefix;
  return `${prefix}: ${label}`;
}

export function returnSinceAddedPct(item: WatchlistItem, quote?: WatchlistQuoteView): number | undefined {
  const current = Number(quote?.price);
  const added = Number(item.addedPrice);
  if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(added) || added <= 0) return undefined;
  return (current / added - 1) * 100;
}

function sortableValue(
  column: WatchlistColumnId,
  item: WatchlistItem,
  quote: WatchlistQuoteView | undefined,
): string | number | undefined {
  switch (column) {
    case 'code': return item.code;
    case 'name': return item.name;
    case 'currentPrice': return quote?.price;
    case 'change': return quote?.change;
    case 'changeRate': return quote?.rate;
    case 'volume': return quote?.volume;
    case 'addedAt': return Date.parse(item.addedAt);
    case 'addedPrice': return item.addedPrice;
    case 'returnSinceAddedPct': return returnSinceAddedPct(item, quote);
    case 'source': return watchlistOriginLabel(latestWatchlistOrigin(item));
    case 'sourceCapturedAt': {
      const origin = latestWatchlistOrigin(item);
      return origin ? Date.parse(origin.capturedAt) : undefined;
    }
    default: return undefined;
  }
}

function missing(value: string | number | undefined): boolean {
  return value === undefined || (typeof value === 'number' && !Number.isFinite(value));
}

function comparePresentValue(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ko-KR', { numeric: true });
}

/** 화면 정렬은 저장된 item.order를 변경하지 않는다. 빈 값은 정렬방향과 무관하게 항상 마지막이다. */
export function sortWatchlistItems(
  items: readonly WatchlistItem[],
  config: WatchlistViewConfig,
  quoteFor: (code: string) => WatchlistQuoteView | undefined,
): WatchlistItem[] {
  const rows = [...items];
  if (!config.sort) return rows.sort((a, b) => a.order - b.order);
  const { column, direction } = config.sort;
  const sign = direction === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    const av = sortableValue(column, a, quoteFor(a.code));
    const bv = sortableValue(column, b, quoteFor(b.code));
    const missingA = missing(av);
    const missingB = missing(bv);
    if (missingA && missingB) return a.order - b.order;
    if (missingA) return 1;
    if (missingB) return -1;
    const compared = comparePresentValue(av as string | number, bv as string | number);
    if (compared !== 0) return compared * sign;
    return a.order - b.order;
  });
}
