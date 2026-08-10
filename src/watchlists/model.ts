export const WATCHLIST_SCHEMA_VERSION = 1;

export interface WatchlistItem {
  code: string;
  name: string;
  note: string;
  order: number;
  addedAt: string;
}

export interface WatchlistGroup {
  id: string;
  name: string;
  order: number;
  items: WatchlistItem[];
}

export interface WatchlistDocument {
  schemaVersion: 1;
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

function normalizeItem(value: unknown, index: number): WatchlistItem | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<WatchlistItem>;
  const code = normalizeWatchlistCode(row.code);
  if (!code) return null;
  return {
    code,
    name: cleanText(row.name, 80),
    note: cleanText(row.note, 240),
    order: index,
    addedAt: /^\d{4}-\d{2}-\d{2}T/.test(String(row.addedAt ?? ''))
      ? String(row.addedAt)
      : new Date(0).toISOString(),
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
  const raw = value && typeof value === 'object' ? value as Partial<WatchlistDocument> : {};
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
