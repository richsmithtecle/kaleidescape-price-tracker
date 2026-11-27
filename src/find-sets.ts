// Looks for sets that ironcross posted about but the tracker has never seen, and prints the
// store slugs it finds so they can be added to bundle-seeds.txt.
//
//   node src/find-sets.ts            (read-only: about 2-3 store requests per name, 2 s apart)
//
// For each unmatched forum bundle name it tries:
//   1. likely store URLs, e.g. "The Mummy 3-Movie Set" -> set/mummy_3_movie_set
//   2. the store page of a film in the set, which names the set it belongs to

import { openDb } from './db.ts';
import { KaleidescapeClient, sleep } from './kaleidescape.ts';

const DELAY = 2000;
const db = openDb();
const known = new Set((db.prepare(`SELECT bundle_id FROM bundles`).all() as { bundle_id: number }[]).map((r) => r.bundle_id));
const names = (db.prepare(`SELECT DISTINCT name FROM forum_price_changes WHERE kind = 'bundle' AND bundle_id IS NULL`).all() as { name: string }[]).map((r) => r.name);

const slugify = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const norm = (s: string) => slugify(s).replace(/_/g, ' ');
/** "The Mummy 3-Movie Set Complete Series" -> "The Mummy 3-Movie Set" */
const setName = (n: string) => n.replace(/^Set:\s*/i, '').replace(/(\b(Set|Collection)\b).*$/i, '$1').trim();
/** "The Mummy 3-Movie Set" -> "The Mummy" */
const franchise = (n: string) => setName(n).replace(/\s*\(\d{4}\)/, '')
  .replace(/\s+(\d+-(Movie|Film|Season)\s+)?(Action\s+)?(Set|Collection|Trilogy.*|Double Feature.*)$/i, '').replace(/:.*$/, '').trim();

const titles = db.prepare(`SELECT edition_id, title, uri_name FROM titles WHERE is_television = ? ORDER BY length(uri_name)`);
const client = new KaleidescapeClient();
await client.init();

const found = new Map<string, string>();   // slug -> set name from the store
for (const raw of names) {
  const name = setName(raw);
  const base = slugify(name);
  const guesses = [...new Set([base, base.replace(/^(the|a|an)_/, '')])];
  let hit: string | null = null;

  for (const slug of guesses) {
    await sleep(DELAY);
    try {
      const d = await client.getBundle(slug);
      if (d.hard_bundle?.hard_bundle_id) { hit = slug; if (!known.has(d.hard_bundle.hard_bundle_id)) found.set(slug, d.title); break; }
    } catch { /* not this slug */ }
  }

  if (!hit) {
    const isTv = /season|series/i.test(raw) ? 1 : 0;
    const f = norm(franchise(raw)).replace(/^(the|a|an) /, '');
    const cands = (titles.all(isTv) as { edition_id: string; title: string }[])
      .filter((t) => norm(t.title).replace(/^(the|a|an) /, '').startsWith(f)).slice(0, 2);
    for (const t of cands) {
      await sleep(DELAY);
      try {
        const d = await client.getTitleDetail(t.edition_id);
        const slug = d.hard_bundle_uri?.replace(/^.*\/set\//, '');
        if (slug && norm(d.hard_bundle_collection_name ?? '').includes(f.split(' ')[0])) {
          hit = slug;
          await sleep(DELAY);
          const s = await client.getBundle(slug);
          if (s.hard_bundle?.hard_bundle_id && !known.has(s.hard_bundle.hard_bundle_id)) found.set(slug, s.title);
          break;
        }
      } catch { /* try the next film */ }
    }
  }
  console.log(`${hit ? 'FOUND  ' : 'missing'}  ${raw}${hit ? `  ->  ${hit}` : ''}`);
}

console.log(`\nNew sets to add to bundle-seeds.txt (${found.size}):`);
for (const [slug, title] of found) console.log(`${slug}    # ${title}`);
db.close();
