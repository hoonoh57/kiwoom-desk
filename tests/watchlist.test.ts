import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeWatchlistCode,
  normalizeWatchlistDocument,
  type WatchlistGroup,
} from '../src/watchlists/model';
import { upsertWatchlistCandidate } from '../src/watchlists/mutations';
import {
  defaultWatchlistViewConfig,
  normalizeWatchlistViewConfig,
  returnSinceAddedPct,
  sortWatchlistItems,
  watchlistOriginLabel,
} from '../src/watchlists/view';
import { WatchlistRevisionConflict, WatchlistStore } from '../server/watchlists';

test('watchlist v1 data migrates to provenance-aware schema v2 without losing rows', () => {
  assert.equal(normalizeWatchlistCode(' A005930 '), '005930');
  assert.equal(normalizeWatchlistCode('005930_al'), '005930_AL');

  const doc = normalizeWatchlistDocument({
    schemaVersion: 1,
    revision: 3,
    groups: [{
      id: 'leaders',
      name: '대장주',
      items: [
        { code: 'A005930', name: '삼성전자', addedAt: '2026-08-10T00:00:00.000Z' },
        { code: '005930', name: 'duplicate' },
        { code: '005930_AL', name: '삼성전자 통합' },
      ],
    }],
  });

  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.revision, 3);
  assert.deepEqual(doc.groups[0].items.map(x => x.code), ['005930', '005930_AL']);
  assert.deepEqual(doc.groups[0].items.map(x => x.order), [0, 1]);
  assert.equal(doc.groups[0].items[0].origins[0].type, 'manual');
  assert.equal(doc.groups[0].items[0].origins[0].label, '수동');
});

test('watchlist candidate upsert preserves first registration and merges independent sources', () => {
  const base = normalizeWatchlistDocument({ groups: [{ id: 'default', name: '기본', items: [] }] });
  const first = upsertWatchlistCandidate(base.groups, 'default', {
    code: '174900',
    name: '앱클론',
    capturedAt: '2026-08-10T00:05:00.000Z',
    capturedPrice: 28300,
    source: { type: 'condition', key: '1516', label: '1516' },
  });
  assert.equal(first.added, true);
  assert.equal(first.item.addedPrice, 28300);
  assert.equal(first.item.addedAt, '2026-08-10T00:05:00.000Z');
  assert.equal(watchlistOriginLabel(first.item.origins[0]), '조건식: 1516');

  const second = upsertWatchlistCandidate(first.groups, 'default', {
    code: '174900',
    name: '앱클론',
    capturedAt: '2026-08-10T00:07:00.000Z',
    capturedPrice: 29000,
    source: { type: 'ranking', key: 'ka10027', label: '전일대비등락률 상위' },
  });
  assert.equal(second.added, false);
  assert.equal(second.originAdded, true);
  assert.equal(second.item.origins.length, 2);
  assert.equal(second.item.addedPrice, 28300, 'first registration price must not be overwritten');

  const repeated = upsertWatchlistCandidate(second.groups, 'default', {
    code: '174900',
    capturedAt: '2026-08-10T00:09:00.000Z',
    capturedPrice: 30100,
    source: { type: 'condition', key: '1516', label: '1516' },
  });
  assert.equal(repeated.item.origins.length, 2, 'same source identity must update instead of growing forever');
  const condition = repeated.item.origins.find(x => x.type === 'condition' && x.key === '1516');
  assert.equal(condition?.capturedPrice, 30100);
  assert.equal(repeated.item.addedPrice, 28300);
});

test('registration return is derived and display sorting never mutates manual order', () => {
  const doc = normalizeWatchlistDocument({
    groups: [{
      id: 'default', name: '기본', items: [
        { code: 'A', name: 'A', addedAt: '2026-08-10T00:00:00.000Z', addedPrice: 100 },
        { code: 'B', name: 'B', addedAt: '2026-08-10T00:01:00.000Z', addedPrice: 100 },
      ],
    }],
  });
  const items = doc.groups[0].items;
  const quotes = new Map([
    ['A', { price: 110, change: 0, rate: 1, volume: 100 }],
    ['B', { price: 130, change: 0, rate: 2, volume: 200 }],
  ]);
  assert.equal(returnSinceAddedPct(items[0], quotes.get('A'))?.toFixed(2), '10.00');

  const config = normalizeWatchlistViewConfig({
    ...defaultWatchlistViewConfig(),
    sort: { column: 'returnSinceAddedPct', direction: 'desc' },
  });
  const sorted = sortWatchlistItems(items, config, code => quotes.get(code));
  assert.deepEqual(sorted.map(x => x.code), ['B', 'A']);
  assert.deepEqual(items.map(x => x.code), ['A', 'B']);
  assert.deepEqual(items.map(x => x.order), [0, 1]);
});

test('empty or damaged watchlist data always restores one default group', () => {
  const doc = normalizeWatchlistDocument({ groups: [] });
  assert.equal(doc.groups.length, 1);
  assert.equal(doc.groups[0].id, 'default');
  assert.equal(doc.groups[0].name, '기본');
});

test('watchlist store persists revisions and rejects stale writers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiwoom-desk-watchlist-'));
  const file = path.join(dir, 'watchlists.json');
  try {
    const store = new WatchlistStore(file);
    const initial = store.load();
    assert.equal(initial.revision, 0);

    const groups: WatchlistGroup[] = [{
      id: 'default',
      name: '기본',
      order: 0,
      items: [{
        code: '005930',
        name: '삼성전자',
        note: 'sample',
        order: 0,
        addedAt: '2026-08-10T00:00:00.000Z',
        addedPrice: 70000,
        origins: [{
          type: 'condition', key: '1516', label: '1516',
          capturedAt: '2026-08-10T00:00:00.000Z', capturedPrice: 70000,
        }],
      }],
    }];
    const first = store.save(0, groups);
    assert.equal(first.revision, 1);
    assert.equal(first.schemaVersion, 2);
    assert.equal(store.load().groups[0].items[0].origins[0].key, '1516');

    assert.throws(
      () => store.save(0, first.groups),
      (error: unknown) => error instanceof WatchlistRevisionConflict
        && error.current.revision === 1,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('watchlist server exposes local GET/PUT API and runtime data is git-ignored', () => {
  const root = path.resolve(process.cwd());
  const server = fs.readFileSync(path.join(root, 'server/watchlists.ts'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'server/index.ts'), 'utf8');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

  assert.match(server, /app\.get\('\/api\/watchlists'/);
  assert.match(server, /app\.put\('\/api\/watchlists'/);
  assert.match(index, /installWatchlistRoutes\(app\)/);
  assert.match(ignore, /^\.watchlists\.json$/m);
});

test('watchlist is a real singleton form with explicit quotes and separate view properties', () => {
  const root = path.resolve(process.cwd());
  const registry = fs.readFileSync(path.join(root, 'src/forms/registry.ts'), 'utf8');
  const form = fs.readFileSync(path.join(root, 'src/forms/WatchlistForm.ts'), 'utf8');
  const onInit = form.slice(form.indexOf('protected onInit'), form.indexOf('private loadView'));

  assert.match(registry, /watchlist:\s*\(c, p\) => new WatchlistForm\(c, p\)/);
  assert.equal(registry.includes("watchlist: ph('watchlist')"), false);
  assert.match(form, /표시\/정렬/);
  assert.match(form, /kiwoom-desk\.watchlist\.view\.v1/);
  assert.match(form, /returnSinceAddedPct/);
  assert.match(form, /this\.ctx\.api\.call<any>\('ka10001'/);
  assert.equal(onInit.includes('refreshQuotes'), false, 'opening the form must not fan out REST quote calls');
});

test('watchlist is reachable from activity bar and query menu', () => {
  const root = path.resolve(process.cwd());
  const workbench = fs.readFileSync(path.join(root, 'src/shell/Workbench.ts'), 'utf8');

  assert.match(workbench, /id: 'watchlist'.*formId: 'watchlist'/);
  assert.match(workbench, /label: '관심종목', cmd: 'view\.open\.watchlist'/);
});
