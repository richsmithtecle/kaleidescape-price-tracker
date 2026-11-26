// Bundle ("Content Set") collection.
//
// Each run:
//   1. One call lists every bundle with its current price (and original price while on sale).
//   2. A bundle's own page is fetched only when needed:
//        - it's new (to record which titles it contains),
//        - it just went on sale, or its sale price changed (to get the sale end date), or
//        - its contents haven't been checked for CONTENTS_REFRESH_DAYS.
//      The first run fetches every bundle page (~336). Later runs usually fetch only a few.

import type { DatabaseSync } from 'node:sqlite';
import { KaleidescapeClient, toCents, sleep, type BundleDetail, type BundleListing } from './kaleidescape.ts';

const CONTENTS_REFRESH_DAYS = 7;

export interface BundleStats {
  bundles_seen: number;
  bundles_on_sale: number;
  bundle_details_fetched: number;
  bundle_changes: number;
}

interface PrevPrice {
  price_cents: number | null;
  regular_cents: number | null;
  on_sale: number;
  sale_end: string | null;
  currency: string | null;
}

const unixToIso = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);
const slugOf = (uri: string) => uri.replace(/^\/?set\//, '').replace(/^\//, '');

export async function collectBundles(
  db: DatabaseSync,
  client: KaleidescapeClient,
  runId: number,
  opts: { delayMs: number; log: (msg: string) => void; stats: BundleStats },
): Promise<void> {
  const { delayMs, log, stats } = opts;

  const getBundle = db.prepare(`SELECT contents_checked_at FROM bundles WHERE bundle_id = ?`);
  const upsertBundle = db.prepare(`
    INSERT INTO bundles (bundle_id, collection_id, name, uri_name, image_url, first_seen, last_seen)
    VALUES (:bundle_id, :collection_id, :name, :uri_name, :image_url, :now, :now)
    ON CONFLICT (bundle_id) DO UPDATE SET collection_id = excluded.collection_id, name = excluded.name,
      uri_name = excluded.uri_name, image_url = excluded.image_url, last_seen = excluded.last_seen
  `);
  const setContentsChecked = db.prepare(`UPDATE bundles SET contents_checked_at = ?, num_items = ? WHERE bundle_id = ?`);
  const clearItems = db.prepare(`DELETE FROM bundle_items WHERE bundle_id = ?`);
  const insertItem = db.prepare(`
    INSERT OR REPLACE INTO bundle_items (bundle_id, edition_id, package_id, title, position) VALUES (?, ?, ?, ?, ?)
  `);
  const latestPrice = db.prepare(`
    SELECT price_cents, regular_cents, on_sale, sale_end, currency
    FROM bundle_price_history WHERE bundle_id = ? ORDER BY id DESC LIMIT 1
  `);
  const insertPrice = db.prepare(`
    INSERT INTO bundle_price_history (bundle_id, run_id, observed_at, currency, price_cents, regular_cents, on_sale, sale_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const listings = await client.getBundleList();
  stats.bundles_seen = listings.length;
  log(`Bundles: ${listings.length} in store`);

  const staleBefore = new Date(Date.now() - CONTENTS_REFRESH_DAYS * 86_400_000).toISOString();

  for (const b of listings) {
    const now = new Date().toISOString();
    const priceCents = toCents(b.est_price);
    const originalCents = toCents(b.est_original_price);
    const onSale = originalCents !== null && priceCents !== null && priceCents < originalCents;
    if (onSale) stats.bundles_on_sale++;
    const current = {
      currency: b.est_price?.currency_code ?? null,
      price_cents: priceCents,
      regular_cents: originalCents ?? priceCents,
      on_sale: onSale ? 1 : 0,
      sale_end: null as string | null,
    };

    const existing = getBundle.get(b.hard_bundle_id) as { contents_checked_at: string | null } | undefined;
    const prev = latestPrice.get(b.hard_bundle_id) as PrevPrice | undefined;
    const sameSaleAsBefore = onSale && prev?.on_sale === 1 && prev.price_cents === priceCents && prev.sale_end;

    const needsDetail =
      !existing?.contents_checked_at ||
      existing.contents_checked_at < staleBefore ||
      (onSale && !sameSaleAsBefore);

    let detail: BundleDetail | null = null;
    if (needsDetail) {
      await sleep(delayMs);
      try {
        detail = await client.getBundle(slugOf(b.uri_name));
        stats.bundle_details_fetched++;
      } catch (err) {
        // One bad bundle page shouldn't stop the run. Keep the list price; try the page again next run.
        log(`WARN: ${String(err instanceof Error ? err.message : err)}`);
      }
    }

    if (onSale) {
      current.sale_end = detail ? unixToIso(detail.hard_bundle?.tpr_end) : (prev?.on_sale ? prev.sale_end : null);
    }

    db.exec('BEGIN');
    try {
      upsertBundle.run({
        bundle_id: b.hard_bundle_id,
        collection_id: b.collection_id ?? null,
        name: b.display_name,
        uri_name: slugOf(b.uri_name),
        image_url: b.image_uris?.medium ?? null,
        now,
      });

      if (detail) {
        clearItems.run(b.hard_bundle_id);
        detail.packages?.forEach((p, i) => {
          if (p.movie_edition_id) insertItem.run(b.hard_bundle_id, p.movie_edition_id, p.package_id ?? null, p.title ?? null, i);
        });
        setContentsChecked.run(now, detail.num_items ?? detail.packages?.length ?? null, b.hard_bundle_id);
      }

      const changed = !prev ||
        prev.price_cents !== current.price_cents ||
        prev.regular_cents !== current.regular_cents ||
        prev.on_sale !== current.on_sale ||
        prev.sale_end !== current.sale_end ||
        prev.currency !== current.currency;
      if (changed) {
        insertPrice.run(b.hard_bundle_id, runId, now, current.currency, current.price_cents,
          current.regular_cents, current.on_sale, current.sale_end);
        stats.bundle_changes++;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    if (stats.bundle_details_fetched > 0 && needsDetail && stats.bundle_details_fetched % 50 === 0) {
      log(`Bundles: ${stats.bundle_details_fetched} bundle pages fetched so far`);
    }
  }

  log(`Bundles: ${stats.bundles_on_sale} on sale, ${stats.bundle_details_fetched} pages fetched, ${stats.bundle_changes} changes`);
}
