// Collects current prices for the whole Kaleidescape catalog and records any changes.
//
//   npm run collect                 full run (~128 requests, about 5 minutes)
//   npm run collect -- --pages 2    only the first 2 catalog pages (for testing)
//   npm run collect -- --delay 3000 wait 3s between requests (default 2s)
//   npm run collect -- --skip-bundles / --skip-titles

import { parseArgs } from 'node:util';
import { openDb } from './db.ts';
import { collectBundles } from './bundles.ts';
import { KaleidescapeClient, toCents, sleep, type CatalogPackage, type SaleOffer } from './kaleidescape.ts';

const { values: args } = parseArgs({
  options: {
    pages: { type: 'string' },          // limit number of catalog pages
    delay: { type: 'string', default: '2000' },
    'skip-bundles': { type: 'boolean', default: false },
    'skip-titles': { type: 'boolean', default: false },
  },
});
const maxPages = args.pages ? Number(args.pages) : Infinity;
const delayMs = Number(args.delay);

const log = (msg: string) => console.log(`${new Date().toISOString()}  ${msg}`);
const unixToIso = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);

const db = openDb();
const client = new KaleidescapeClient();
const startedAt = new Date().toISOString();

const runId = Number(
  db.prepare(`INSERT INTO runs (started_at, status) VALUES (?, 'running')`).run(startedAt).lastInsertRowid,
);

// ---- Prepared statements ----
const titleExists = db.prepare(`SELECT 1 FROM titles WHERE edition_id = ?`);
const upsertTitle = db.prepare(`
  INSERT INTO titles (edition_id, movie_id, package_id, uri_name, title, season_name, edition_summary,
    is_television, is_preorder, media_quality, audio_codec, rating, rt_critic, rt_audience, image_url,
    first_seen, last_seen)
  VALUES (:edition_id, :movie_id, :package_id, :uri_name, :title, :season_name, :edition_summary,
    :is_television, :is_preorder, :media_quality, :audio_codec, :rating, :rt_critic, :rt_audience, :image_url,
    :now, :now)
  ON CONFLICT (edition_id) DO UPDATE SET
    movie_id = excluded.movie_id, package_id = excluded.package_id, uri_name = excluded.uri_name,
    title = excluded.title, season_name = excluded.season_name, edition_summary = excluded.edition_summary,
    is_television = excluded.is_television, is_preorder = excluded.is_preorder,
    media_quality = excluded.media_quality, audio_codec = excluded.audio_codec, rating = excluded.rating,
    rt_critic = excluded.rt_critic, rt_audience = excluded.rt_audience, image_url = excluded.image_url,
    last_seen = excluded.last_seen
`);
const latestPrice = db.prepare(`
  SELECT package_id, currency, price_cents, regular_cents, rental_cents, offer_type, sale_start, sale_end
  FROM price_history WHERE edition_id = ? ORDER BY id DESC LIMIT 1
`);
const insertPrice = db.prepare(`
  INSERT INTO price_history (edition_id, package_id, run_id, observed_at, currency, price_cents,
    regular_cents, rental_cents, offer_type, sale_start, sale_end)
  VALUES (:edition_id, :package_id, :run_id, :observed_at, :currency, :price_cents,
    :regular_cents, :rental_cents, :offer_type, :sale_start, :sale_end)
`);
const updateRun = db.prepare(`
  UPDATE runs SET finished_at = :finished_at, status = :status, store_version = :store_version,
    pages_expected = :pages_expected, pages_fetched = :pages_fetched, titles_seen = :titles_seen,
    sales_seen = :sales_seen, new_titles = :new_titles, price_changes = :price_changes, error = :error,
    bundles_seen = :bundles_seen, bundles_on_sale = :bundles_on_sale,
    bundle_details_fetched = :bundle_details_fetched, bundle_changes = :bundle_changes
  WHERE id = :id
`);

// ---- Run state ----
const stats = {
  store_version: null as string | null,
  pages_expected: null as number | null,
  pages_fetched: 0,
  titles_seen: 0,
  sales_seen: 0,
  new_titles: 0,
  price_changes: 0,
  bundles_seen: 0,
  bundles_on_sale: 0,
  bundle_details_fetched: 0,
  bundle_changes: 0,
};
const seenThisRun = new Set<string>();
const PRICE_FIELDS = ['package_id', 'currency', 'price_cents', 'regular_cents', 'rental_cents',
  'offer_type', 'sale_start', 'sale_end'] as const;

function saveTitle(pkg: CatalogPackage, offers: Record<string, SaleOffer>, now: string) {
  const editionId = pkg.movie_edition_id;
  if (!editionId || seenThisRun.has(editionId)) return; // listed twice (catalog shifted while paging)
  seenThisRun.add(editionId);
  stats.titles_seen++;

  if (!titleExists.get(editionId)) stats.new_titles++;
  upsertTitle.run({
    edition_id: editionId,
    movie_id: pkg.movie_id ?? null,
    package_id: pkg.package_id ?? null,
    uri_name: pkg.movie_edition_uri_name ?? null,
    title: pkg.title,
    season_name: pkg.season_name || null,
    edition_summary: pkg.edition_summary || null,
    is_television: pkg.is_television ? 1 : 0,
    is_preorder: pkg.is_preorder ? 1 : 0,
    media_quality: pkg.media_quality ?? null,
    audio_codec: pkg.audio_codec_type ?? null,
    rating: pkg.rating ?? null,
    rt_critic: pkg.rt_critic_score ?? null,
    rt_audience: pkg.rt_audience_score ?? null,
    image_url: pkg.image_uris?.medium ?? null,
    now,
  });

  const offer = offers[String(pkg.package_id)];
  const current = {
    package_id: pkg.package_id,
    currency: pkg.base_price?.currency_code ?? pkg.est_base_price?.currency_code ?? null,
    price_cents: toCents(pkg.base_price),
    regular_cents: toCents(pkg.est_base_price),
    rental_cents: toCents(pkg.rental_price),
    offer_type: offer?.type ?? null,
    sale_start: unixToIso(offer?.window_start),
    sale_end: unixToIso(offer?.window_end),
  };

  const previous = latestPrice.get(editionId) as Record<string, unknown> | undefined;
  const changed = !previous || PRICE_FIELDS.some((f) => previous[f] !== current[f]);
  if (changed) {
    insertPrice.run({ ...current, edition_id: editionId, run_id: runId, observed_at: now });
    stats.price_changes++;
  }
}

function savePage(packages: CatalogPackage[], offers: Record<string, SaleOffer>) {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const pkg of packages) saveTitle(pkg, offers, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---- Main ----
const errors: string[] = [];
let titlesOk = args['skip-titles'];
let bundlesOk = args['skip-bundles'];

async function collectTitles() {
  const offers = await client.getSaleOffers();
  stats.sales_seen = Object.keys(offers).length;
  log(`Sale offers: ${stats.sales_seen} packages on sale`);

  await sleep(delayMs);
  const first = await client.getCatalogPage(1);
  stats.pages_expected = Math.min(first.num_pages, maxPages);
  savePage(first.packages, offers);
  stats.pages_fetched = 1;
  log(`Catalog page 1/${stats.pages_expected} (${first.num_pages} pages in store)`);

  for (let page = 2; page <= stats.pages_expected; page++) {
    await sleep(delayMs);
    const data = await client.getCatalogPage(page);
    savePage(data.packages, offers);
    stats.pages_fetched = page;
    if (page % 10 === 0 || page === stats.pages_expected) {
      log(`Catalog page ${page}/${stats.pages_expected}: ${stats.titles_seen} titles, ${stats.price_changes} changes so far`);
    }
  }
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

try {
  stats.store_version = await client.init();
  log(`Store version ${stats.store_version}`);

  if (!args['skip-titles']) {
    try {
      await collectTitles();
      titlesOk = true;
    } catch (err) {
      errors.push(`titles: ${errMsg(err)}`);
      log(`ERROR (titles): ${errMsg(err)}`);
    }
  }

  if (!args['skip-bundles']) {
    try {
      await sleep(delayMs);
      await collectBundles(db, client, runId, { delayMs, log, stats });
      bundlesOk = true;
    } catch (err) {
      errors.push(`bundles: ${errMsg(err)}`);
      log(`ERROR (bundles): ${errMsg(err)}`);
    }
  }
} catch (err) {
  errors.push(errMsg(err));
  log(`ERROR: ${errMsg(err)}`);
}

const gotSomething = stats.pages_fetched > 0 || stats.bundles_seen > 0;
const status = titlesOk && bundlesOk ? 'ok' : gotSomething ? 'partial' : 'failed';
if (status !== 'ok') process.exitCode = 1;
updateRun.run({ ...stats, id: runId, finished_at: new Date().toISOString(), status, error: errors.join(' | ') || null });
db.close();

log(`Run ${runId} ${status}: ${stats.titles_seen} titles (${stats.new_titles} new, ${stats.price_changes} price changes, ` +
  `${stats.pages_fetched}/${stats.pages_expected ?? '?'} pages); ${stats.bundles_seen} bundles ` +
  `(${stats.bundles_on_sale} on sale, ${stats.bundle_changes} changes, ${stats.bundle_details_fetched} pages fetched)`);
