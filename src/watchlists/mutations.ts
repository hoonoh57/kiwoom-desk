import {
  normalizeWatchlistCode,
  type WatchlistGroup,
  type WatchlistItem,
  type WatchlistOrigin,
  type WatchlistSourceType,
} from './model';

export interface WatchlistCandidate {
  code: string;
  name?: string;
  note?: string;
  capturedAt?: string;
  capturedPrice?: number;
  source?: {
    type?: WatchlistSourceType;
    key?: string;
    label?: string;
  };
}

export interface UpsertWatchlistCandidateResult {
  groups: WatchlistGroup[];
  item: WatchlistItem;
  added: boolean;
  originAdded: boolean;
}

function clean(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function positive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function timestamp(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && Number.isFinite(Date.parse(raw))) return raw;
  return new Date().toISOString();
}

function normalizeType(value: unknown): WatchlistSourceType {
  const type = String(value ?? 'manual');
  return type === 'condition' || type === 'ranking' || type === 'strategy' || type === 'import'
    ? type
    : 'manual';
}

function buildOrigin(candidate: WatchlistCandidate, capturedAt: string, capturedPrice?: number): WatchlistOrigin {
  const type = normalizeType(candidate.source?.type);
  const key = clean(candidate.source?.key, 120);
  const defaultLabel = type === 'manual'
    ? '수동'
    : type === 'condition'
      ? '조건식'
      : type === 'ranking'
        ? '랭킹'
        : type === 'strategy'
          ? '전략'
          : '가져오기';
  return {
    type,
    key,
    label: clean(candidate.source?.label, 120) || key || defaultLabel,
    capturedAt,
    capturedPrice,
  };
}

function cloneGroups(groups: WatchlistGroup[]): WatchlistGroup[] {
  return groups.map(group => ({
    ...group,
    items: group.items.map(item => ({
      ...item,
      origins: item.origins.map(origin => ({ ...origin })),
    })),
  }));
}

/**
 * 조건식/랭킹/전략/수동 UI가 공통으로 사용할 수 있는 관심종목 삽입 계약.
 *
 * - code는 그룹 안에서 유일하다.
 * - 동일 source(type+key)가 다시 들어오면 origin을 무한히 늘리지 않고 최신 포착시각/가격으로 갱신한다.
 * - 서로 다른 source는 origins[]에 함께 남긴다.
 * - addedAt/addedPrice는 첫 등록 기준값이므로 재유입 때문에 덮어쓰지 않는다.
 *
 * 모든 개별 포착 이벤트의 장기 이력은 별도 signal/performance log의 책임이며,
 * Watchlist는 현재 작업목록과 provenance만 유지한다.
 */
export function upsertWatchlistCandidate(
  groups: WatchlistGroup[],
  groupId: string,
  candidate: WatchlistCandidate,
): UpsertWatchlistCandidateResult {
  const next = cloneGroups(groups);
  const group = next.find(item => item.id === groupId);
  if (!group) throw new Error(`Watchlist group not found: ${groupId}`);

  const code = normalizeWatchlistCode(candidate.code);
  if (!code) throw new Error('Watchlist candidate code is required.');

  const capturedAt = timestamp(candidate.capturedAt);
  const capturedPrice = positive(candidate.capturedPrice);
  const origin = buildOrigin(candidate, capturedAt, capturedPrice);
  let item = group.items.find(row => row.code === code);

  if (!item) {
    item = {
      code,
      name: clean(candidate.name, 80),
      note: clean(candidate.note, 240),
      order: group.items.length,
      addedAt: capturedAt,
      addedPrice: capturedPrice,
      origins: [origin],
    };
    group.items.push(item);
    return { groups: next, item, added: true, originAdded: true };
  }

  if (!item.name && candidate.name) item.name = clean(candidate.name, 80);
  if (!item.note && candidate.note) item.note = clean(candidate.note, 240);
  if (!item.addedPrice && capturedPrice) item.addedPrice = capturedPrice;

  const originIndex = item.origins.findIndex(row => row.type === origin.type && row.key === origin.key);
  if (originIndex >= 0) {
    item.origins[originIndex] = origin;
    return { groups: next, item, added: false, originAdded: false };
  }

  item.origins.push(origin);
  return { groups: next, item, added: false, originAdded: true };
}
