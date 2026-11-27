// Loads the database into memory and merges the two price sources into one timeline:
//   - forum_price_changes: ironcross's posts (history before this tracker started)
//   - price_history / bundle_price_history: this tracker's own runs
// Forum changes are used only before the tracker's first run, so nothing is counted twice.
// The data is reloaded automatically when a new collection run or forum import lands.

import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../db.ts';
import { dayKey, familyFromForum, labelFromForum, fromMediaQuality, type Family } from './format.ts';
import { links } from './links.ts';

export type Kind = 'title' | 'tv' | 'bundle';
export type Dir = 'down' | 'up' | 'added';

export interface Item {
  key: string;                 // "t:<edition_id>" or "b:<bundle_id>"
  kind: Kind;
  name: string;
  storePath: string;           // e.g. "movie/wonka-2023" or "set/james_bond_set"
  family: Family;              // format family of what the store sells now
  formatLabel: string;         // e.g. "Cinematic DV Atmos"
  rating: string | null;
  rtCritic: number | null;
  numItems: number | null;     // bundles
  price: number | null;        // current, cents
  regular: number | null;
  rental: number | null;
  onSale: boolean;
  saleEnd: string | null;      // ISO
  changes: Change[];           // oldest first
}

export interface Change {
  item: Item | null;           // null when a forum line couldn't be matched to the store
  name: string;                // display name
  kind: Kind;
  at: string;                  // ISO time
  day: string;                 // YYYY-MM-DD, Eastern
  dir: Dir;
  price: number;
  old: number | null;
  family: Family | null;
  formatLabel: string;
  source: 'forum' | 'tracker';
  postId: number | null;
  /** For price drops, compared with every earlier price of this item and format family:
   *  'new' = lower than all of them, 'equal' = ties the earlier lowest, null = neither. */
  low: 'new' | 'equal' | null;
}

export interface Data {
  items: Map<string, Item>;
  changes: Change[];           // newest first
  days: string[];              // days that have changes, newest first
  trackerStart: string | null; // ISO time of the first tracker run
  lastUpdated: string | null;  // ISO time the latest successful price check finished
  loadedAt: number;
}

const withYear = (title: string, slug: string | null) => {
  const y = [...(slug ?? '').matchAll(/(?:^|-)((?:19|20)\d\d)(?=-|$)/g)].map((m) => m[1]).pop();
  return y && !title.includes(`(${y})`) ? `${title} (${y})` : title;
};

function load(): Data {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const runTimes = db.prepare(`SELECT min(started_at) s, max(finished_at) f FROM runs WHERE status IN ('ok','partial')`).get() as { s: string | null; f: string | null };
    const trackerStart = runTimes.s;
    const items = new Map<string, Item>();

    for (const r of db.prepare(`SELECT * FROM current_prices`).all() as Record<string, any>[]) {
      const f = fromMediaQuality(r.media_quality, r.audio_codec);
      items.set(`t:${r.edition_id}`, {
        key: `t:${r.edition_id}`, kind: r.is_television ? 'tv' : 'title', name: withYear(r.title, r.uri_name),
        storePath: `movie/${r.uri_name}`, family: f.family, formatLabel: f.label, rating: r.rating, rtCritic: r.rt_critic,
        numItems: null, price: r.price_cents, regular: r.regular_cents, rental: r.rental_cents,
        onSale: !!r.offer_type, saleEnd: r.offer_type ? r.sale_end : null, changes: [],
      });
    }
    for (const r of db.prepare(`SELECT * FROM current_bundle_prices`).all() as Record<string, any>[]) {
      items.set(`b:${r.bundle_id}`, {
        key: `b:${r.bundle_id}`, kind: 'bundle', name: r.name, storePath: `set/${r.uri_name}`, family: '4K', formatLabel: '',
        rating: null, rtCritic: null, numItems: r.num_items, price: r.price_cents, regular: r.regular_cents, rental: null,
        onSale: !!r.on_sale, saleEnd: r.on_sale ? r.sale_end : null, changes: [],
      });
    }

    const all: Change[] = [];
    const push = (c: Omit<Change, 'day' | 'low'>) => all.push({ ...c, day: dayKey(c.at), low: null });

    // Forum history (before the tracker started)
    const forum = db.prepare(`SELECT * FROM forum_price_changes ${trackerStart ? 'WHERE posted_at < ?' : ''} ORDER BY posted_at, id`)
      .all(...(trackerStart ? [trackerStart] : [])) as Record<string, any>[];
    for (const r of forum) {
      const item = r.edition_id ? items.get(`t:${r.edition_id}`) ?? null : r.bundle_id ? items.get(`b:${r.bundle_id}`) ?? null : null;
      const kind: Kind = item?.kind ?? (r.kind === 'bundle' ? 'bundle' : /tv/i.test(r.section ?? '') ? 'tv' : 'title');
      push({
        item, name: item?.name ?? (r.year ? `${r.name} (${r.year})` : r.name), kind, at: r.posted_at,
        dir: r.direction === 'listed' ? 'added' : r.direction, price: r.price_cents, old: r.old_price_cents,
        family: kind === 'bundle' ? '4K' : familyFromForum(r.format), formatLabel: labelFromForum(r.format),
        source: 'forum', postId: r.post_id,
      });
    }

    // Tracker history: consecutive rows with a different price are changes.
    // Titles first seen after the first run day are "added".
    const firstDay = trackerStart ? dayKey(trackerStart) : null;
    const trackerRows = (sql: string, prefix: string) => {
      let prevKey = '', prev: Record<string, any> | null = null;
      for (const r of db.prepare(sql).all() as Record<string, any>[]) {
        const key = `${prefix}${r.id_}`;
        const item = items.get(key) ?? null;
        if (key !== prevKey) {
          prevKey = key; prev = r;
          if (item && firstDay && dayKey(r.observed_at) > firstDay && r.price_cents != null) {
            push({ item, name: item.name, kind: item.kind, at: r.observed_at, dir: 'added', price: r.price_cents, old: null,
              family: item.family, formatLabel: item.formatLabel, source: 'tracker', postId: null });
          }
          continue;
        }
        if (item && r.price_cents != null && prev!.price_cents != null && r.price_cents !== prev!.price_cents) {
          push({ item, name: item.name, kind: item.kind, at: r.observed_at, dir: r.price_cents < prev!.price_cents ? 'down' : 'up',
            price: r.price_cents, old: prev!.price_cents, family: item.family, formatLabel: item.formatLabel, source: 'tracker', postId: null });
        }
        prev = r;
      }
    };
    trackerRows(`SELECT edition_id AS id_, observed_at, price_cents FROM price_history ORDER BY edition_id, id`, 't:');
    trackerRows(`SELECT bundle_id AS id_, observed_at, price_cents FROM bundle_price_history ORDER BY bundle_id, id`, 'b:');

    all.sort((a, b) => a.at.localeCompare(b.at));

    // Attach to items and label price drops against every earlier price (including the
    // price it dropped from) for the same item and format family.
    const lows = new Map<string, number>();
    for (const c of all) {
      const k = `${c.item?.key ?? 'x:' + c.name}|${c.family}`;
      const prevLow = lows.get(k);
      const before = Math.min(prevLow ?? Infinity, c.old ?? Infinity);
      if (c.dir === 'down' && before !== Infinity) c.low = c.price < before ? 'new' : c.price === before ? 'equal' : null;
      lows.set(k, Math.min(prevLow ?? Infinity, c.price, c.old ?? Infinity));
      c.item?.changes.push(c);
    }

    const changes = all.reverse();
    const days = [...new Set(changes.map((c) => c.day))];
    return { items, changes, days, trackerStart, lastUpdated: runTimes.f, loadedAt: Date.now() };
  } finally {
    db.close();
  }
}

// ---- Cache, refreshed when the database gets new data ----
let cache: Data | null = null;
let stamp = '';

function currentStamp(): string {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const r = db.prepare(`SELECT (SELECT max(id) FROM runs) a, (SELECT count(*) FROM forum_price_changes) b,
      (SELECT max(id) FROM price_history) c, (SELECT max(id) FROM bundle_price_history) d`).get() as Record<string, unknown>;
    return `${r.a}|${r.b}|${r.c}|${r.d}`;
  } finally {
    db.close();
  }
}

export function getData(): Data {
  const s = currentStamp();
  if (!cache || s !== stamp) {
    const t = Date.now();
    cache = load();
    stamp = s;
    console.log(`Loaded ${cache.items.size} items and ${cache.changes.length} changes in ${Date.now() - t} ms`);
  }
  return cache;
}

/** Item lookup for history pages: "title/<edition_id>" or "bundle/<bundle_id>". */
export function findItem(type: 'title' | 'bundle', id: string): Item | undefined {
  return getData().items.get(`${type === 'title' ? 't' : 'b'}:${id}`);
}

export function historyPath(item: Item): string {
  const [p, id] = item.key.split(':');
  return p === 't' ? links.title(id) : links.bundle(id);
}
