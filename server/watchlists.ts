import type { Express } from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normalizeWatchlistDocument,
  type WatchlistDocument,
  type WatchlistGroup,
} from '../src/watchlists/model';

export class WatchlistRevisionConflict extends Error {
  constructor(readonly current: WatchlistDocument) {
    super('watchlist revision conflict');
  }
}

export class WatchlistStore {
  constructor(readonly filePath = resolve('.watchlists.json')) {}

  load(): WatchlistDocument {
    try {
      return normalizeWatchlistDocument(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      return normalizeWatchlistDocument({});
    }
  }

  save(expectedRevision: number, groups: WatchlistGroup[]): WatchlistDocument {
    const current = this.load();
    if (expectedRevision !== current.revision) {
      throw new WatchlistRevisionConflict(current);
    }

    const next = normalizeWatchlistDocument({
      revision: current.revision + 1,
      groups,
    });
    // 관심종목 문서는 작고 로컬 전용이다. Windows에서 기존 파일 위 rename 동작이
    // 파일시스템/보안SW에 따라 달라질 수 있으므로 직접 동기 write를 사용한다.
    writeFileSync(this.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }
}

export function installWatchlistRoutes(
  app: Express,
  store = new WatchlistStore(),
): void {
  app.get('/api/watchlists', (_req, res) => {
    res.json(store.load());
  });

  app.put('/api/watchlists', (req, res) => {
    const expectedRevision = Number(req.body?.revision);
    const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      res.status(400).json({ error: 'revision must be a non-negative integer' });
      return;
    }

    try {
      res.json(store.save(expectedRevision, groups));
    } catch (error) {
      if (error instanceof WatchlistRevisionConflict) {
        res.status(409).json({ error: 'revision conflict', current: error.current });
        return;
      }
      res.status(500).json({ error: String((error as Error)?.message ?? error) });
    }
  });
}
