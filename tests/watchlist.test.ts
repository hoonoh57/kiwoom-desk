import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeWatchlistCode,
  normalizeWatchlistDocument,
} from '../src/watchlists/model';
import { WatchlistRevisionConflict, WatchlistStore } from '../server/watchlists';

test('watchlist codes normalize market variants and duplicate rows are removed', () => {
  assert.equal(normalizeWatchlistCode(' A005930 '), '005930');
  assert.equal(normalizeWatchlistCode('005930_al'), '005930_AL');

  const doc = normalizeWatchlistDocument({
    revision: 3,
    groups: [{
      id: 'leaders',
      name: '대장주',
      items: [
        { code: 'A005930', name: '삼성전자' },
        { code: '005930', name: 'duplicate' },
        { code: '005930_AL', name: '삼성전자 통합' },
      ],
    }],
  });

  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.revision, 3);
  assert.deepEqual(doc.groups[0].items.map(x => x.code), ['005930', '005930_AL']);
  assert.deepEqual(doc.groups[0].items.map(x => x.order), [0, 1]);
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

    const first = store.save(0, [{
      id: 'default',
      name: '기본',
      order: 0,
      items: [{
        code: '005930',
        name: '삼성전자',
        note: 'sample',
        order: 0,
        addedAt: '2026-08-10T00:00:00.000Z',
      }],
    }]);
    assert.equal(first.revision, 1);
    assert.equal(store.load().groups[0].items[0].code, '005930');

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

test('watchlist is a real singleton form and quote refresh remains explicit', () => {
  const root = path.resolve(process.cwd());
  const registry = fs.readFileSync(path.join(root, 'src/forms/registry.ts'), 'utf8');
  const form = fs.readFileSync(path.join(root, 'src/forms/WatchlistForm.ts'), 'utf8');
  const onInit = form.slice(form.indexOf('protected onInit'), form.indexOf('private async load'));

  assert.match(registry, /watchlist:\s*\(c, p\) => new WatchlistForm\(c, p\)/);
  assert.equal(registry.includes("watchlist: ph('watchlist')"), false);
  assert.match(form, /시세 새로고침/);
  assert.match(form, /this\.ctx\.api\.call<any>\('ka10001'/);
  assert.equal(onInit.includes('refreshQuotes'), false, 'opening the form must not fan out REST quote calls');
});

test('watchlist is reachable from activity bar and query menu', () => {
  const root = path.resolve(process.cwd());
  const workbench = fs.readFileSync(path.join(root, 'src/shell/Workbench.ts'), 'utf8');

  assert.match(workbench, /id: 'watchlist'.*formId: 'watchlist'/);
  assert.match(workbench, /label: '관심종목', cmd: 'view\.open\.watchlist'/);
});
