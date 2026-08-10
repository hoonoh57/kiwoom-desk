import type { Express } from 'express';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
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
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(temp, this.filePath);
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
