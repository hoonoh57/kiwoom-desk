import {
  normalizeWatchlistDocument,
  type WatchlistDocument,
  type WatchlistGroup,
} from '../watchlists/model';

export class WatchlistConflictError extends Error {
  constructor(readonly current: WatchlistDocument) {
    super('관심종목이 다른 화면에서 먼저 변경되었습니다.');
  }
}

export class WatchlistClient {
  constructor(private readonly base = '/api/watchlists') {}

  async load(signal?: AbortSignal): Promise<WatchlistDocument> {
    const res = await fetch(this.base, { signal });
    if (!res.ok) throw new Error(`관심종목 조회 실패 (HTTP ${res.status})`);
    return normalizeWatchlistDocument(await res.json());
  }

  async save(
    revision: number,
    groups: WatchlistGroup[],
    signal?: AbortSignal,
  ): Promise<WatchlistDocument> {
    const res = await fetch(this.base, {
      method: 'PUT',
      headers: { 'content-type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ revision, groups }),
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) {
      throw new WatchlistConflictError(normalizeWatchlistDocument(body?.current));
    }
    if (!res.ok) {
      throw new Error(String(body?.error ?? `관심종목 저장 실패 (HTTP ${res.status})`));
    }
    return normalizeWatchlistDocument(body);
  }
}
