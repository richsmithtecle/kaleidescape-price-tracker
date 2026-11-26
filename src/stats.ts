// Quick summary of what's in the database.   npm run stats

import { openDb } from './db.ts';

const db = openDb();
const q = (sql: string, ...params: (string | number)[]) => db.prepare(sql).all(...params);
const money = (c: unknown) => (typeof c === 'number' ? `$${(c / 100).toFixed(2)}` : '-');

console.log('\nRecent runs');
console.table(q(`SELECT id, started_at, status, pages_fetched || '/' || pages_expected AS pages,
  titles_seen, price_changes, bundles_seen, bundle_changes, bundle_details_fetched AS bundle_pages, error
  FROM runs ORDER BY id DESC LIMIT 5`));

console.log('Totals');
console.table(q(`SELECT
  (SELECT count(*) FROM titles) AS titles,
  (SELECT count(*) FROM titles WHERE is_television = 1) AS tv,
  (SELECT count(*) FROM price_history) AS price_rows,
  (SELECT count(*) FROM current_prices WHERE offer_type IS NOT NULL) AS on_sale_now,
  (SELECT count(*) FROM bundles) AS bundles,
  (SELECT count(*) FROM current_bundle_prices WHERE on_sale = 1) AS bundles_on_sale,
  (SELECT count(*) FROM bundle_items) AS bundle_items`));

console.log('Sales ending next (by end date)');
console.table(q(`SELECT substr(sale_end, 1, 16) AS ends_utc, count(*) AS titles
  FROM current_prices WHERE offer_type IS NOT NULL GROUP BY 1 ORDER BY 1 LIMIT 10`));

console.log('Biggest current discounts');
console.table((q(`SELECT title, price_cents, regular_cents, substr(sale_end, 1, 10) AS ends
  FROM current_prices WHERE offer_type IS NOT NULL AND regular_cents > 0
  ORDER BY (regular_cents - price_cents) DESC, title LIMIT 10`) as Record<string, unknown>[])
  .map((r) => ({ title: r.title, now: money(r.price_cents), regular: money(r.regular_cents), ends: r.ends })));

console.log('Biggest current bundle discounts');
console.table((q(`SELECT name, num_items, price_cents, regular_cents, substr(sale_end, 1, 10) AS ends
  FROM current_bundle_prices WHERE on_sale = 1
  ORDER BY (regular_cents - price_cents) DESC, name LIMIT 10`) as Record<string, unknown>[])
  .map((r) => ({ bundle: r.name, titles: r.num_items, now: money(r.price_cents), regular: money(r.regular_cents), ends: r.ends })));

db.close();
