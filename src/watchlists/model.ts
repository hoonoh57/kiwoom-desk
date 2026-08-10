export const WATCHLIST_SCHEMA_VERSION = 2;

export type WatchlistSourceType = 'manual' | 'condition' | 'ranking' | 'strategy' | 'import';

export interface WatchlistOrigin {
  type: WatchlistSourceType;
  key: string;
  label: string;
  capturedAt: string;
  capturedPrice?: number;
}

export interface WatchlistItem {
  code: string;
  name: string;
  note: string;
  order: number;
  /** 이 관심종목 항목이 처음 생성된 시각. */
  addedAt: string;
  /** 처음 등록 당시의 기준 가격. 현재가는 저장하지 않고 화면에서 별도로 합성한다. */
  addedPrice?: number;
  /** 조건식/랭킹/전략/수동 등 이 종목이 관심목록에 들어온 provenance. */
  origins: WatchlistOrigin[];
}

export interface WatchlistGroup {
  id: string;
  name: string;
  order: number;
  items: WatchlistItem[];
}

export interface WatchlistDocument {
  schemaVersion: 2;
  revision: number;
  groups: WatchlistGroup[];
}

export function normalizeWatchlistCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/^A(?=\d{6}(?:_|$))/, '');
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && Number.isFinite(Date.parse(raw))) return raw;
  return fallback;
}

function positiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function normalizeSourceType(value: unknown): WatchlistSourceType {
  const type = String(value ?? '').trim();
  return type === 'condition' || type === 'ranking' || type === 'strategy' || type === 'import'
    ? type
    : 'manual';
}

function normalizeOrigin(value: unknown, fallbackAt: string, fallbackPrice?: number): WatchlistOrigin | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<WatchlistOrigin>;
  return {
    type: normalizeSourceType(row.type),
    key: cleanText(row.key, 120),
    label: cleanText(row.label, 120),
    capturedAt: normalizeTimestamp(row.capturedAt, fallbackAt),
    capturedPrice: positiveNumber(row.capturedPrice) ?? fallbackPrice,
  };
}

function manualOrigin(addedAt: string, addedPrice?: number): WatchlistOrigin {
  return {
    type: 'manual',
    key: '',
    label: '수동',
    capturedAt: addedAt,
    capturedPrice: addedPrice,
  };
}

function normalizeItem(value: unknown, index: number): WatchlistItem | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<WatchlistItem> & {
    // schema v1 및 다른 프로젝트에서 들어올 수 있는 단일 source 필드와 호환한다.
    source?: Partial<WatchlistOrigin>;
  };
  const code = normalizeWatchlistCode(row.code);
  if (!code) return null;

  const epoch = new Date(0).toISOString();
  const addedAt = normalizeTimestamp(row.addedAt, epoch);
  const addedPrice = positiveNumber(row.addedPrice);
  const rawOrigins = Array.isArray(row.origins)
    ? row.origins
    : row.source
      ? [row.source]
      : [];
  const seenOrigin = new Set<string>();
  const origins = rawOrigins
    .map(origin => normalizeOrigin(origin, addedAt, addedPrice))
    .filter((origin): origin is WatchlistOrigin => {
      if (!origin) return false;
      const id = `${origin.type}|${origin.key}`;
      if (seenOrigin.has(id)) return false;
      seenOrigin.add(id);
      return true;
    });

  // schema v1은 provenance가 없었으므로 기존 항목은 수동 등록으로 안전하게 이관한다.
  if (!origins.length) origins.push(manualOrigin(addedAt, addedPrice));

  return {
    code,
    name: cleanText(row.name, 80),
    note: cleanText(row.note, 240),
    order: index,
    addedAt,
    addedPrice,
    origins,
  };
}

function defaultGroup(): WatchlistGroup {
  return { id: 'default', name: '기본', order: 0, items: [] };
}

function normalizeGroup(value: unknown, index: number): WatchlistGroup | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<WatchlistGroup>;
  const id = cleanText(row.id, 80) || `group-${index + 1}`;
  const name = cleanText(row.name, 80) || `그룹 ${index + 1}`;
  const seen = new Set<string>();
  const items = (Array.isArray(row.items) ? row.items : [])
    .map(normalizeItem)
    .filter((item): item is WatchlistItem => {
      if (!item || seen.has(item.code)) return false;
      seen.add(item.code);
      return true;
    })
    .map((item, itemIndex) => ({ ...item, order: itemIndex }));
  return { id, name, order: index, items };
}

export function normalizeWatchlistDocument(value: unknown): WatchlistDocument {
  const raw = value && typeof value === 'object'
    ? value as Partial<Omit<WatchlistDocument, 'schemaVersion'>> & { schemaVersion?: number }
    : {};
  const seenIds = new Set<string>();
  let groups = (Array.isArray(raw.groups) ? raw.groups : [])
    .map(normalizeGroup)
    .filter((group): group is WatchlistGroup => {
      if (!group || seenIds.has(group.id)) return false;
      seenIds.add(group.id);
      return true;
    })
    .map((group, index) => ({ ...group, order: index }));
  if (!groups.length) groups = [defaultGroup()];

  const revision = Number(raw.revision);
  return {
    schemaVersion: WATCHLIST_SCHEMA_VERSION,
    revision: Number.isInteger(revision) && revision >= 0 ? revision : 0,
    groups,
  };
}

export function createWatchlistGroup(name: string, id?: string): WatchlistGroup {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 7);
  return {
    id: cleanText(id, 80) || `group-${stamp}-${random}`,
    name: cleanText(name, 80) || '새 그룹',
    order: 0,
    items: [],
  };
}
