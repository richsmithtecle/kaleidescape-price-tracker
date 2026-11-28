// Builds the whole app as static files for GitHub Pages.
//
//   node src/web/build.ts --base /kaleidescape-price-tracker --out site
//
// --repo owner/name (default: $GITHUB_REPOSITORY) turns on the "Check prices now" button.
// --base is the path the site lives under (for a project site: "/<repo name>").
// Writes: index.html, older/<day>/, day/<day>/, title/<id>/, bundle/<id>/, search/, static/, 404.html

import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { PROJECT_ROOT } from '../db.ts';
import { configureLinks } from './links.ts';
import { getData } from './data.ts';
import { feedPage, dayPage, itemPage, staticSearchPage, searchIndex, notFoundPage } from './pages.ts';

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: '' },
    out: { type: 'string', default: join(PROJECT_ROOT, 'site') },
    // "owner/name" of the GitHub repository, for the "Check prices now" button. GitHub Actions sets
    // GITHUB_REPOSITORY; without either, the button is left out.
    repo: { type: 'string', default: process.env.GITHUB_REPOSITORY ?? '' },
  },
});
configureLinks({ base: args.base, static: true, repo: args.repo });
const OUT = args.out!;
const started = Date.now();

rmSync(OUT, { recursive: true, force: true });
let files = 0, bytes = 0;
function write(rel: string, content: string) {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  files++; bytes += Buffer.byteLength(content);
}

const d = getData();

// Feed: newest 7 days at the root, then one page per older batch.
write('index.html', feedPage());
const DAYS_PER_PAGE = 7;
for (let i = DAYS_PER_PAGE; i < d.days.length; i += DAYS_PER_PAGE) {
  const before = d.days[i - 1];
  write(`older/${before}/index.html`, feedPage(before));
}

for (const day of d.days) write(`day/${day}/index.html`, dayPage(day)!);

for (const item of d.items.values()) {
  const [p, id] = item.key.split(':');
  write(`${p === 't' ? 'title' : 'bundle'}/${id}/index.html`, itemPage(item));
}

write('search/index.html', staticSearchPage());
write('static/search-index.json', JSON.stringify(searchIndex()));
write('404.html', notFoundPage());
write('.nojekyll', '');                 // serve files as-is (no Jekyll processing)

const assets: [string, string][] = [
  [join(PROJECT_ROOT, 'public', 'app.css'), 'app.css'],
  [join(PROJECT_ROOT, 'public', 'chart-page.js'), 'chart-page.js'],
  [join(PROJECT_ROOT, 'public', 'search.js'), 'search.js'],
  [join(PROJECT_ROOT, 'public', 'refresh.js'), 'refresh.js'],
  [join(PROJECT_ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), 'chart.umd.js'],
];
mkdirSync(join(OUT, 'static'), { recursive: true });
for (const [from, to] of assets) { copyFileSync(from, join(OUT, 'static', to)); files++; }

console.log(`Built ${files.toLocaleString()} files (${(bytes / 1e6).toFixed(1)} MB of HTML/JSON) into ${OUT} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
