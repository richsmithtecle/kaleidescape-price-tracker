// Imports ironcross's forum posts for one year into forum_posts / forum_price_changes,
// matching each line to a title or bundle in the tracker's database.
//
//   node src/forum/import.ts --year 2026
//   node src/forum/import.ts --year 2026 --dry-run      report only, write nothing
//
// Input: data/forum/ironcross-posts.json (saved from the browser; see README).
// Re-running a year replaces that year's rows, so it's safe to repeat.
// Unmatched and unparsed lines are written to data/forum/report-<year>.txt for review.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { openDb, PROJECT_ROOT } from '../db.ts';
import { parsePost, type ParsedChange } from './parse.ts';

const { values: args } = parseArgs({
  options: {
    year: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    input: { type: 'string', default: join(PROJECT_ROOT, 'data', 'forum', 'ironcross-posts.json') },
  },
});
if (!args.year || !/^\d{4}$/.test(args.year)) {
  console.error('Usage: node src/forum/import.ts --year 2026 [--dry-run]');
  process.exit(1);
}
const YEAR = args.year;

interface PageRec { n: number; posts: { id: string; date: string; text: string }[] }
const pages = JSON.parse(readFileSync(args.input, 'utf8')) as PageRec[];

// ---- Name normalisation for matching ----
export function norm(s: string): string {
  let t = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // "Quiet Place, A 3-Movie Set" -> "a quiet place 3-movie set"
  t = t.replace(/^([^,]+),\s*(the|a|an)\b\s*/, '$2 $1 ');
  t = t.replace(/&/g, ' and ').replace(/[’‘`]/g, "'").replace(/'/g, '');
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  return t;
}
/** Store-style slug: "Mr. & Mrs. Smith" -> "mr-and-mrs-smith". */
function slugify(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’‘`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
/** Extra normalisation: drop a leading article and turn standalone Roman numerals into digits. */
function loose(n: string): string {
  return n.replace(/^(the|a|an) /, '').split(' ').map((w) => ROMAN[w] ?? w).join(' ');
}
/** Release year from a store slug: the last 19xx/20xx token, e.g. "blade-runner-2049-2017" -> 2017. */
function slugYear(uri: string | null): number | null {
  const ys = [...(uri ?? '').matchAll(/(?:^|-)((?:19|20)\d\d)(?=-|$)/g)].map((m) => Number(m[1]));
  return ys.length ? ys[ys.length - 1] : null;
}

const db = openDb();

// Title index: "name|year" and "name" -> candidates
type Cand = { edition_id: string; uri_name: string | null };
const byNameYear = new Map<string, Cand[]>();
const byName = new Map<string, Cand[]>();
const byLooseYear = new Map<string, Cand[]>();
const bySlug = new Map<string, Cand[]>();
const add = (m: Map<string, Cand[]>, k: string, c: Cand) => (m.get(k) ?? m.set(k, []).get(k)!).push(c);
for (const t of db.prepare(`SELECT edition_id, title, uri_name FROM titles`).all() as
  { edition_id: string; title: string; uri_name: string | null }[]) {
  const n = norm(t.title);
  const y = slugYear(t.uri_name);
  const c = { edition_id: t.edition_id, uri_name: t.uri_name };
  if (y) add(byNameYear, `${n}|${y}`, c);
  if (y) add(byLooseYear, `${loose(n)}|${y}`, c);
  add(byName, n, c);
  if (t.uri_name) {
    add(bySlug, t.uri_name, c);
    const noId = t.uri_name.replace(/-[0-9a-f]{10,}$/, '');   // some slugs end in an internal id
    if (noId !== t.uri_name) add(bySlug, noId, c);
  }
}

/**
 * Slugs ironcross's naming would produce. Edition names come after the title in his posts
 * ("The Martian Extended Edition (2015)") but after the year in store slugs
 * ("the-martian-2015-extended-edition"), so also try moving the last 1-5 words after the year.
 */
function slugCandidates(name: string, year: number): string[] {
  const words = name.split(/\s+/);
  const out = [`${slugify(name)}-${year}`];
  for (let k = 1; k <= Math.min(5, words.length - 1); k++) {
    out.push(`${slugify(words.slice(0, -k).join(' '))}-${year}-${slugify(words.slice(-k).join(' '))}`);
  }
  return out;
}
// Prefer the plain edition (shortest slug) when there are several, e.g. theatrical vs extended.
const pick = (cs: Cand[]) => [...cs].sort((a, b) => (a.uri_name?.length ?? 99) - (b.uri_name?.length ?? 99))[0];

const bundleByName = new Map<string, number>();
const bundleByLoose = new Map<string, number>();
const bundleBySlug = new Map<string, number>();
for (const b of db.prepare(`SELECT bundle_id, name, uri_name FROM bundles`).all() as { bundle_id: number; name: string; uri_name: string | null }[]) {
  bundleByName.set(norm(b.name), b.bundle_id);
  bundleByLoose.set(loose(norm(b.name)), b.bundle_id);
  if (b.uri_name) bundleBySlug.set(b.uri_name.replace(/_/g, '-'), b.bundle_id);
}
/** ironcross sometimes adds words after the set name: "Arrow 8-Season Set Complete Series",
 *  "Set: PAW Patrol 3-Movie Set PAW Patrol: The Movie / ...". Keep "... Set" / "... Collection". */
const setNameOnly = (n: string) => n.replace(/^Set:\s*/i, '').replace(/(\b(Set|Collection)\b).*$/i, '$1').trim();

function matchTitle(c: ParsedChange): { edition_id: string; method: string } | null {
  const n = norm(c.name);
  if (c.year) {
    const exact = byNameYear.get(`${n}|${c.year}`);
    if (exact?.length) return { edition_id: pick(exact).edition_id, method: exact.length > 1 ? 'name+year (several editions)' : 'name+year' };
    for (const s of slugCandidates(c.name, c.year)) {
      const hit = bySlug.get(s);
      if (hit?.length) return { edition_id: pick(hit).edition_id, method: 'slug' };
    }
    const lz = byLooseYear.get(`${loose(n)}|${c.year}`);
    if (lz?.length) return { edition_id: pick(lz).edition_id, method: 'loose name+year' };
    for (const y of [c.year - 1, c.year + 1]) {            // store and poster sometimes differ by a year
      const near = byNameYear.get(`${n}|${y}`);
      if (near?.length) return { edition_id: pick(near).edition_id, method: 'name+year±1' };
    }
  }
  const any = byName.get(n);
  if (any?.length === 1) return { edition_id: any[0].edition_id, method: 'name only' };
  return null;
}
function matchBundle(c: ParsedChange): { bundle_id: number; method: string } | null {
  const id = bundleByName.get(norm(c.name));
  if (id) return { bundle_id: id, method: 'bundle name' };
  const lz = bundleByLoose.get(loose(norm(c.name)));
  if (lz) return { bundle_id: lz, method: 'loose bundle name' };
  const trimmed = setNameOnly(c.name);
  if (trimmed !== c.name) {
    const t = bundleByName.get(norm(trimmed)) ?? bundleByLoose.get(loose(norm(trimmed)));
    if (t) return { bundle_id: t, method: 'bundle name (extra words dropped)' };
  }
  // Store slugs, with and without a leading article: "The Mummy 3-Movie Set" -> mummy-3-movie-set
  const s = slugify(trimmed);
  const bySlug = bundleBySlug.get(s) ?? bundleBySlug.get(s.replace(/^(the|a|an)-/, ''));
  return bySlug ? { bundle_id: bySlug, method: 'bundle slug' } : null;
}

// ---- Collect this year's posts ----
const toUtc = (d: string) => new Date(d).toISOString();
const posts = pages.flatMap((p) => p.posts.map((post) => ({ ...post, page: p.n })))
  .filter((p) => p.date && toUtc(p.date).startsWith(YEAR))
  .sort((a, b) => a.date.localeCompare(b.date));

const postIdNum = (id: string) => Number(String(id).replace(/\D/g, ''));
const stats = { posts: posts.length, lines: 0, titles: 0, titlesMatched: 0, bundles: 0, bundlesMatched: 0, skipped: 0 };
const unmatched = new Map<string, number>();
const skippedLines: string[] = [];
const methods = new Map<string, number>();

const rows: Record<string, unknown>[] = [];
for (const post of posts) {
  const { changes, skipped } = parsePost(post.text);
  stats.skipped += skipped.length;
  skipped.forEach((s) => skippedLines.push(`${post.date.slice(0, 10)}  ${s}`));
  for (const c of changes) {
    stats.lines++;
    let edition_id: string | null = null, bundle_id: number | null = null, method: string | null = null;
    if (c.kind === 'bundle') {
      stats.bundles++;
      const m = matchBundle(c);
      if (m) { bundle_id = m.bundle_id; method = m.method; stats.bundlesMatched++; }
    } else {
      stats.titles++;
      const m = matchTitle(c);
      if (m) { edition_id = m.edition_id; method = m.method; stats.titlesMatched++; }
    }
    if (method) methods.set(method, (methods.get(method) ?? 0) + 1);
    else {
      const key = `[${c.kind}] ${c.name}${c.year ? ` (${c.year})` : ''}`;
      unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
    }
    rows.push({
      post_id: postIdNum(post.id), posted_at: toUtc(post.date), line_no: c.line_no, section: c.section,
      kind: c.kind, direction: c.direction, name: c.name, year: c.year, format: c.format,
      price_cents: c.price_cents, change_cents: c.change_cents, old_price_cents: c.old_price_cents,
      edition_id, bundle_id, match_method: method, raw: c.raw,
    });
  }
}

// ---- Write ----
if (!args['dry-run']) {
  const insPost = db.prepare(`INSERT OR REPLACE INTO forum_posts (post_id, posted_at, page, url) VALUES (?, ?, ?, ?)`);
  const insChange = db.prepare(`INSERT INTO forum_price_changes (post_id, posted_at, line_no, section, kind, direction,
    name, year, format, price_cents, change_cents, old_price_cents, edition_id, bundle_id, match_method, raw)
    VALUES (:post_id, :posted_at, :line_no, :section, :kind, :direction, :name, :year, :format, :price_cents,
    :change_cents, :old_price_cents, :edition_id, :bundle_id, :match_method, :raw)`);
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM forum_price_changes WHERE substr(posted_at, 1, 4) = ?`).run(YEAR);
    for (const p of posts) {
      const id = postIdNum(p.id);
      insPost.run(id, toUtc(p.date), p.page, `https://www.kscapeowners.com/XF/posts/${id}/`);
    }
    for (const r of rows) insChange.run(r as never);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}
db.close();

// ---- Report ----
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const summary = [
  `Year ${YEAR}${args['dry-run'] ? ' (dry run, nothing written)' : ''}`,
  `Posts: ${stats.posts}   price lines: ${stats.lines}   unparsed lines: ${stats.skipped}`,
  `Titles:  ${stats.titlesMatched}/${stats.titles} matched (${pct(stats.titlesMatched, stats.titles)})`,
  `Bundles: ${stats.bundlesMatched}/${stats.bundles} matched (${pct(stats.bundlesMatched, stats.bundles)})`,
  `Match methods: ${[...methods].map(([k, v]) => `${k} ${v}`).join(', ')}`,
  `Distinct unmatched names: ${unmatched.size}`,
].join('\n');
const reportPath = join(PROJECT_ROOT, 'data', 'forum', `report-${YEAR}.txt`);
writeFileSync(reportPath, [
  summary, '',
  '== Unmatched (most frequent first) ==',
  ...[...unmatched].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(4)}  ${k}`), '',
  '== Unparsed lines ==', ...skippedLines,
].join('\n'));
console.log(summary);
console.log(`Report: ${reportPath}`);
