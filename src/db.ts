// Database setup. Uses Node's built-in SQLite, so there is nothing extra to install.
// The database is a single file: data/tracker.db

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const PROJECT_ROOT = join(import.meta.dirname, '..');
export const DB_PATH = join(PROJECT_ROOT, 'data', 'tracker.db');

const SCHEMA = `
-- One row per title (a "movie edition" in Kaleidescape's terms; TV seasons count as titles).
CREATE TABLE IF NOT EXISTS titles (
  edition_id     TEXT PRIMARY KEY,      -- Kaleidescape movie_edition_id
  movie_id       INTEGER,
  package_id     INTEGER,               -- main (best-format) package shown in the store
  uri_name       TEXT,                  -- store URL slug: /movie-store/movie/<uri_name>
  title          TEXT NOT NULL,
  season_name    TEXT,
  edition_summary TEXT,
  is_television  INTEGER NOT NULL DEFAULT 0,
  is_preorder    INTEGER NOT NULL DEFAULT 0,
  media_quality  TEXT,
  audio_codec    TEXT,
  rating         TEXT,
  rt_critic      INTEGER,
  rt_audience    INTEGER,
  image_url      TEXT,
  first_seen     TEXT NOT NULL,         -- ISO UTC time of first run that saw it
  last_seen      TEXT NOT NULL          -- ISO UTC time of latest run that saw it
);

-- One row per collection run, so gaps and failures are visible.
CREATE TABLE IF NOT EXISTS runs (
  id             INTEGER PRIMARY KEY,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  status         TEXT NOT NULL,         -- running | ok | partial | failed
  store_version  TEXT,
  pages_expected INTEGER,
  pages_fetched  INTEGER NOT NULL DEFAULT 0,
  titles_seen    INTEGER NOT NULL DEFAULT 0,
  sales_seen     INTEGER NOT NULL DEFAULT 0,
  new_titles     INTEGER NOT NULL DEFAULT 0,
  price_changes  INTEGER NOT NULL DEFAULT 0,
  error          TEXT
);

-- Price history. A row is added only when something changes (price, regular price,
-- rental price or sale window), so each row means "from observed_at onward, it was this".
CREATE TABLE IF NOT EXISTS price_history (
  id             INTEGER PRIMARY KEY,
  edition_id     TEXT NOT NULL REFERENCES titles(edition_id),
  package_id     INTEGER NOT NULL,
  run_id         INTEGER REFERENCES runs(id),
  observed_at    TEXT NOT NULL,
  currency       TEXT,
  price_cents    INTEGER,               -- what it costs right now (sale price if on sale)
  regular_cents  INTEGER,               -- normal purchase price
  rental_cents   INTEGER,
  offer_type     TEXT,                  -- 'EST-TPR' while on sale, otherwise NULL
  sale_start     TEXT,                  -- ISO UTC, when on sale
  sale_end       TEXT                   -- ISO UTC, when on sale
);
CREATE INDEX IF NOT EXISTS idx_price_history_title ON price_history(edition_id, observed_at);

-- Bundles ("Content Sets", e.g. "MCU Spider-Man 4-Movie Set"). One row per bundle.
CREATE TABLE IF NOT EXISTS bundles (
  bundle_id      INTEGER PRIMARY KEY,   -- Kaleidescape hard_bundle_id
  collection_id  INTEGER,
  name           TEXT NOT NULL,
  uri_name       TEXT,                  -- store URL slug: /movie-store/set/<uri_name>
  image_url      TEXT,
  num_items      INTEGER,
  first_seen     TEXT NOT NULL,
  last_seen      TEXT NOT NULL,
  contents_checked_at TEXT              -- when bundle_items was last refreshed
);

-- Titles contained in each bundle.
CREATE TABLE IF NOT EXISTS bundle_items (
  bundle_id      INTEGER NOT NULL REFERENCES bundles(bundle_id),
  edition_id     TEXT NOT NULL,         -- matches titles.edition_id
  package_id     INTEGER,
  title          TEXT,
  position       INTEGER,
  PRIMARY KEY (bundle_id, edition_id)
);

-- Bundle price history. Same rule as price_history: a row only when something changes.
CREATE TABLE IF NOT EXISTS bundle_price_history (
  id             INTEGER PRIMARY KEY,
  bundle_id      INTEGER NOT NULL REFERENCES bundles(bundle_id),
  run_id         INTEGER REFERENCES runs(id),
  observed_at    TEXT NOT NULL,
  currency       TEXT,
  price_cents    INTEGER,               -- what the bundle costs right now
  regular_cents  INTEGER,               -- normal bundle price
  on_sale        INTEGER NOT NULL,      -- 1 while discounted
  sale_end       TEXT                   -- ISO UTC, when on sale
);
CREATE INDEX IF NOT EXISTS idx_bundle_price_history ON bundle_price_history(bundle_id, observed_at);

CREATE VIEW IF NOT EXISTS current_bundle_prices AS
SELECT b.*, p.price_cents, p.regular_cents, p.currency, p.on_sale, p.sale_end, p.observed_at AS price_since
FROM bundles b
JOIN bundle_price_history p ON p.id = (
  SELECT id FROM bundle_price_history WHERE bundle_id = b.bundle_id ORDER BY id DESC LIMIT 1
);

-- Historical price changes posted by forum user "ironcross" in the kscapeowners.com
-- "Movies on Sale..." thread (2020 onward). Kept separate from the live data because it's
-- a different source: a change log of what one person posted, not a full daily snapshot.
CREATE TABLE IF NOT EXISTS forum_posts (
  post_id        INTEGER PRIMARY KEY,
  posted_at      TEXT NOT NULL,         -- ISO UTC
  page           INTEGER,
  url            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_price_changes (
  id             INTEGER PRIMARY KEY,
  post_id        INTEGER NOT NULL REFERENCES forum_posts(post_id),
  posted_at      TEXT NOT NULL,         -- ISO UTC (copied from the post for easy querying)
  line_no        INTEGER NOT NULL,      -- line within the post
  section        TEXT,                  -- heading it appeared under, e.g. "TV Decreased"
  kind           TEXT NOT NULL,         -- title | bundle
  direction      TEXT NOT NULL,         -- down | up | listed (price only, e.g. "Bundle Added")
  name           TEXT NOT NULL,         -- name as posted, without year and format
  year           INTEGER,
  format         TEXT,                  -- e.g. "DV Atmos", "HD DTS-HD Master 5.1"
  price_cents    INTEGER NOT NULL,      -- new price
  change_cents   INTEGER,               -- size of the change (always positive)
  old_price_cents INTEGER,              -- price before the change
  edition_id     TEXT,                  -- matched title (NULL if not matched)
  bundle_id      INTEGER,               -- matched bundle (NULL if not matched)
  match_method   TEXT,                  -- how it was matched, or NULL
  raw            TEXT NOT NULL          -- the original line
);
CREATE INDEX IF NOT EXISTS idx_forum_changes_title ON forum_price_changes(edition_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_forum_changes_bundle ON forum_price_changes(bundle_id, posted_at);

-- Latest known price for each title.
CREATE VIEW IF NOT EXISTS current_prices AS
SELECT t.*, p.price_cents, p.regular_cents, p.rental_cents, p.currency,
       p.offer_type, p.sale_start, p.sale_end, p.observed_at AS price_since
FROM titles t
JOIN price_history p ON p.id = (
  SELECT id FROM price_history WHERE edition_id = t.edition_id ORDER BY id DESC LIMIT 1
);
`;

export function openDb(path = DB_PATH): DatabaseSync {
  mkdirSync(join(path, '..'), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Adds columns introduced after the database was first created. */
function migrate(db: DatabaseSync) {
  const runCols = new Set((db.prepare(`PRAGMA table_info(runs)`).all() as { name: string }[]).map((c) => c.name));
  for (const col of ['bundles_seen', 'bundles_on_sale', 'bundle_details_fetched', 'bundle_changes']) {
    if (!runCols.has(col)) db.exec(`ALTER TABLE runs ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
  }
}
