// HTML for each page. Server-rendered; the only client script is the chart.

import { links } from './links.ts';
import { getData, historyPath, type Change, type Item, type Kind, type Dir } from './data.ts';
import { esc, money, dayHeading, shortDate, monthDay, saleEnd, updatedAt, pageShell } from './format.ts';

const SITE_TITLE = 'Kaleidescape Store Price Tracker';

const STORE = 'https://www.kaleidescape.com/movie-store/';
const FORUM_POST = 'https://www.kscapeowners.com/XF/posts/';

// Tabler-style outline icons, inlined so the app works offline.
const ICONS: Record<string, string> = {
  ext: '<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/>',
  chart: '<path d="M4 19h16"/><path d="M4 15l4 -6l4 2l4 -5l4 4"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="M21 21l-6 -6"/>',
  back: '<path d="M15 6l-6 6l6 6"/>',
  down: '<path d="M3 7l6 6l4 -4l8 8"/><path d="M21 10v7h-7"/>',
  up: '<path d="M3 17l6 -6l4 4l8 -8"/><path d="M14 7h7v7"/>',
  tv: '<path d="M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M16 3l-4 4l-4 -4"/>',
  stack: '<path d="M12 4l-8 4l8 4l8 -4z"/><path d="M4 12l8 4l8 -4"/><path d="M4 16l8 4l8 -4"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  refresh: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
};
// Defined once per page; each use is a short <use> reference, which keeps long lists small.
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${Object.entries(ICONS)
  .map(([n, p]) => `<symbol id="i-${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</symbol>`).join('')}</defs></svg>`;
const icon = (n: string) => `<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;
const shell = (title: string, body: string) => pageShell(title, SPRITE + body);

const storeLink = (item: Item | null, name: string) => item
  ? `<a class="name" href="${STORE}${esc(item.storePath)}" target="_blank" rel="noopener">${esc(name)}</a>`
  : `<span class="name">${esc(name)}</span>`;
/** One list row: title (opens the store) and details on the left; price and change on the right,
 *  which together open the price history. Used by the feed, day pages and search. */
function listRow(item: Item | null, name: string, meta: string, price: number | null, chg: string): string {
  const right = `<span class="price">${money(price)}</span>${chg}`;
  return `<div class="row"><div class="left">${storeLink(item, name)}<div class="meta">${meta}</div></div>${item
    ? `<a class="pricecol" href="${historyPath(item)}" aria-label="Price history for ${esc(name)}, ${money(price)}">${right}</a>`
    : `<span class="pricecol">${right}</span>`}</div>`;
}

function changeText(c: Change): string {
  if (c.dir === 'added' || c.old === null) return `<span class="chg new">New</span>`;
  const diff = Math.abs(c.price - c.old);
  return `<span class="chg ${c.dir}">${c.dir === 'down' ? '↓' : '↑'} ${money(diff)}</span>`;
}

/** Alphabetical order ignoring leading quotes and punctuation ("Wuthering Heights" sorts under W). */
const sortKey = (name: string) => name.replace(/^[^\p{L}\p{N}]+/u, '');

function feedRow(c: Change): string {
  const item = c.item;
  // Most important first, so on a narrow screen it's the format that gets cut off.
  const meta: string[] = [];
  if (c.low === 'new') meta.push('<span class="lo new-low">NEW LOWEST PRICE</span>');
  else if (c.low === 'equal') meta.push('<span class="lo">Lowest</span>');
  if (item?.onSale && item.saleEnd && c.dir === 'down' && item.changes[item.changes.length - 1] === c) {
    meta.push(`<span class="ends">Ends ${esc(monthDay(item.saleEnd))}</span>`);
  }
  if (c.kind === 'bundle') { if (item?.numItems) meta.push(`${item.numItems} titles`); }
  else if (c.formatLabel) meta.push(esc(c.formatLabel));
  return listRow(item, c.name, meta.join(' · '), c.price, changeText(c));
}

const SECTIONS: { dir: Dir; kind: Kind; title: string; icon: string; cls: string }[] = [
  { dir: 'down', kind: 'title', title: 'Decreased', icon: 'down', cls: 'down' },
  { dir: 'up', kind: 'title', title: 'Increased', icon: 'up', cls: 'up' },
  { dir: 'down', kind: 'tv', title: 'TV Decreased', icon: 'tv', cls: 'down' },
  { dir: 'up', kind: 'tv', title: 'TV Increased', icon: 'tv', cls: 'up' },
  { dir: 'down', kind: 'bundle', title: 'Bundle Decreased', icon: 'stack', cls: 'down' },
  { dir: 'up', kind: 'bundle', title: 'Bundle Increased', icon: 'stack', cls: 'up' },
  { dir: 'added', kind: 'title', title: 'Added', icon: 'plus', cls: 'new' },
  { dir: 'added', kind: 'tv', title: 'TV Added', icon: 'plus', cls: 'new' },
  { dir: 'added', kind: 'bundle', title: 'Bundle Added', icon: 'stack', cls: 'new' },
];
const SHOW_FIRST = 10;
const DAYS_PER_PAGE = 7;

let byDayCache: { at: number; map: Map<string, Change[]> } | null = null;
function changesByDay(): Map<string, Change[]> {
  const d = getData();
  if (byDayCache?.at !== d.loadedAt) {
    const map = new Map<string, Change[]>();
    for (const c of d.changes) (map.get(c.day) ?? map.set(c.day, []).get(c.day)!).push(c);
    byDayCache = { at: d.loadedAt, map };
  }
  return byDayCache.map;
}

const header = (title: string, right = `<a class="iconbtn" href="${links.search()}" aria-label="Search">${icon('search')}</a>`) =>
  `<div class="top"><h1>${esc(title)}</h1>${right}</div>`;

/** One day's sections. On the feed each section shows its biggest changes and links to the full day. */
function daySections(day: string, all: boolean): string {
  const list = changesByDay().get(day) ?? [];
  let h = '';
  SECTIONS.forEach((s, i) => {
    const rows = list.filter((c) => c.dir === s.dir && c.kind === s.kind)
      .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name), 'en', { sensitivity: 'base', numeric: true }));
    if (!rows.length) return;
    h += `<div class="sec" id="s${i}">${s.title} <span class="n">${rows.length}</span></div>`;
    h += (all ? rows : rows.slice(0, SHOW_FIRST)).map(feedRow).join('');
    if (!all && rows.length > SHOW_FIRST) h += `<a class="more" href="${links.day(day)}#s${i}">Show ${rows.length - SHOW_FIRST} more</a>`;
  });
  return h;
}
const dayTitle = (day: string) => {
  const n = changesByDay().get(day)?.length ?? 0;
  return `${esc(dayHeading(day))} · ${n.toLocaleString()} change${n === 1 ? '' : 's'}`;
};

export function dayPage(day: string): string | null {
  if (!changesByDay().has(day)) return null;
  const h = `<a class="back" href="${links.home()}">${icon('back')}Price Tracker</a><div class="day" style="margin-top:4px">${dayTitle(day)}</div>${daySections(day, true)}`;
  return shell(dayHeading(day), h);
}

/** "Check prices now": starts the GitHub workflow and shows its progress (public/refresh.js).
 *  Only on the GitHub Pages site; hidden until the script runs. */
function refreshControl(): string {
  if (!links.repo()) return '';
  return `<div class="refresh" id="refresh" data-repo="${esc(links.repo())}" data-workflow="collect.yml" hidden>
<button type="button" class="refresh-btn">${icon('refresh')}<span class="refresh-label">Check prices now</span></button>
<div class="refresh-status" role="status" aria-live="polite"></div>
<form class="refresh-setup" hidden>
<p>To start a check from this device, it needs a GitHub key that's allowed to run the price check. You only do this once per device.</p>
<ol>
<li><a class="refresh-keylink" target="_blank" rel="noopener">Create a key on GitHub</a>.</li>
<li>Under <b>Repository access</b>, choose <b>Only select repositories</b> and pick <b>${esc(links.repo().split('/')[1])}</b>. Actions: Read and write is already filled in.</li>
<li>Tap <b>Generate token</b>, copy it, and paste it here.</li>
</ol>
<input type="password" class="refresh-key" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="GitHub key">
<p class="refresh-note">Saved only in this browser. It can run and cancel price checks, and nothing else.</p>
<div class="refresh-actions"><button type="submit" class="refresh-save">Save and check now</button><button type="button" class="refresh-cancel">Cancel</button></div>
</form>
<script src="${links.asset('refresh.js')}" defer></script>
</div>`;
}

export function feedPage(before?: string): string {
  const d = getData();
  const days = d.days.filter((x) => !before || x < before).slice(0, DAYS_PER_PAGE);
  let h = header(SITE_TITLE);
  if (d.lastUpdated) h += `<p class="updated">Updated ${esc(updatedAt(d.lastUpdated))}</p>`;
  h += refreshControl();
  if (!days.length) h += `<p class="empty">No price changes yet. Run <code>npm run collect</code> to start recording.</p>`;
  for (const day of days) h += `<div class="day">${dayTitle(day)}</div>${daySections(day, false)}`;
  const older = d.days.find((x) => x < (days[days.length - 1] ?? ''));
  h += `<div class="pager"><span>${before ? `<a href="${links.home()}">Newest</a>` : ''}</span><span>${older ? `<a href="${links.older(days[days.length - 1])}">Older days</a>` : ''}</span></div>`;
  return shell(SITE_TITLE, h);
}

// ---- Title and bundle history page ----

function statsFor(item: Item) {
  const cs = item.changes.filter((c) => (c.family ?? item.family) === item.family);
  const prices = [...cs.flatMap((c) => [c.price, c.old ?? c.price]), ...(item.price != null ? [item.price] : [])];
  const low = prices.length ? Math.min(...prices) : null;
  const high = prices.length ? Math.max(...prices) : null;
  const drops = cs.filter((c) => c.dir === 'down' && c.old !== null && c.price < c.old);
  const counts = new Map<number, number>();
  for (const c of drops) counts.set(c.price, (counts.get(c.price) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const lowDates = cs.filter((c) => c.price === low && c.dir !== 'up').map((c) => c.at);
  const highAt = cs.find((c) => c.price === high || c.old === high)?.at ?? null;
  return { cs, low, high, drops, top, lowDates, highAt, first: cs[0]?.at ?? null };
}

function listDates(isos: string[]): string {
  if (!isos.length) return 'Current price';
  if (isos.length > 2) return `${isos.length} times, latest ${shortDate(isos[isos.length - 1])}`;
  const [a, b] = isos.map(shortDate);
  if (!b) return a;
  const [ya, yb] = [a.slice(-4), b.slice(-4)];
  return ya === yb ? `${a.slice(0, -6)} and ${b}` : `${a} and ${b}`;
}

function chartData(item: Item, trackerStart: string | null) {
  const now = Date.now();
  const fams = [item.family, ...new Set(item.changes.map((c) => c.family ?? item.family).filter((f) => f !== item.family))];
  const series = fams.map((f) => {
    const cs = item.changes.filter((c) => (c.family ?? item.family) === f);
    const pts: [number, number][] = [];
    for (const c of cs) {
      const t = Date.parse(c.at);
      if (c.old !== null) pts.push([t, c.old / 100]);
      pts.push([t, c.price / 100]);
    }
    if (f === item.family && item.price != null) {
      if (!pts.length) pts.push([Date.parse(trackerStart ?? new Date().toISOString()), item.price / 100]);
      pts.push([now, item.price / 100]);
    }
    return { label: f, points: pts };
  }).filter((s) => s.points.length);
  const start = Math.min(...series.flatMap((s) => s.points.map((p) => p[0])));
  return { series, start: start - 7 * 864e5, end: now };
}

export function itemPage(item: Item): string {
  const d = getData();
  const st = statsFor(item);
  const isBundle = item.kind === 'bundle';
  const sub = isBundle
    ? ['Bundle', item.numItems ? `${item.numItems} titles` : ''].filter(Boolean).join(' · ')
    : [item.kind === 'tv' ? 'TV' : '', item.formatLabel, item.rating, item.rtCritic != null ? `Rotten Tomatoes ${item.rtCritic}%` : ''].filter(Boolean).join(' · ');

  const tags: string[] = [];
  if (item.onSale) {
    const last = item.changes[item.changes.length - 1];
    if (last?.dir === 'down' && last.price === item.price) {
      if (last.low === 'new') tags.push('<span class="lo new-low">NEW LOWEST PRICE</span>');
      else if (last.low === 'equal') tags.push('<span class="lo">Lowest</span>');
    }
    if (item.saleEnd) tags.push(`<span class="ends">Sale ends ${esc(saleEnd(item.saleEnd))}</span>`);
  } else tags.push('<span class="muted">Regular price · Not on sale</span>');
  if (item.rental) tags.push(`<span class="muted">Rent ${money(item.rental)}</span>`);

  const since = st.first ? `since ${monthYear(st.first)}` : 'no history yet';
  const usual = st.top && st.top[1] >= 2
    ? { v: money(st.top[0]), n: `${st.top[1]} of ${st.drops.length} drops` }
    : st.drops.length
      ? { v: 'Varies', n: `${st.drops.length} drop${st.drops.length === 1 ? '' : 's'}, ${money(Math.min(...st.drops.map((c) => c.price)))}–${money(Math.max(...st.drops.map((c) => c.price)))}` }
      : { v: 'None yet', n: st.first ? `No sales ${since}` : 'No history yet' };
  const highNote = st.high === item.price ? `Now${st.highAt ? `, and ${monthYear(st.highAt)}` : ''}` : st.highAt ? monthYear(st.highAt) : '';

  const cd = chartData(item, d.trackerStart);
  const spanDays = (cd.end - cd.start) / 864e5;
  const ranges = spanDays > 730 ? [['1 year', 365], ['2 years', 730]] : spanDays > 365 ? [['6 months', 182], ['1 year', 365]] : [['3 months', 91], ['6 months', 182]];
  const legend = cd.series.length > 1
    ? `<div class="legend">${cd.series.map((s, i) => `<span><span class="sw" style="border-color:var(${i ? '--chart-gray' : '--chart-blue'});${i ? 'border-top-style:dashed' : ''}"></span>${esc(s.label)}${i ? ' (sold separately)' : ''}</span>`).join('')}</div>` : '';

  const changes = [...item.changes].reverse();
  const crow = (c: Change) => `<div class="crow"><div><div>${money(c.price)} ${c.old !== null ? `<span class="muted">from ${money(c.old)}</span>` : '<span class="muted">listed</span>'}</div>
    <div class="l2 s">${esc(shortDate(c.at))}${c.formatLabel && !isBundle ? ` · ${esc(c.formatLabel)}` : ''} · ${c.source === 'forum' && c.postId
      ? `<a class="src" href="${FORUM_POST}${c.postId}/" target="_blank" rel="noopener" aria-label="Source: ironcross forum post ${c.postId}">Source${icon('ext')}</a>`
      : '<span>Tracker</span>'}</div></div>${changeText(c)}</div>`;
  const hasForum = item.changes.some((c) => c.source === 'forum');

  const body = `
  <a class="back" href="${links.home()}">${icon('back')}Price Tracker</a>
  <h1 class="ttl">${esc(item.name)}</h1>
  <p class="sub s">${esc(sub)}</p>
  <div class="now"><span class="big">${money(item.price)}</span>${item.onSale && item.regular && item.regular !== item.price ? `<span class="was">${money(item.regular)}</span>` : ''}</div>
  <div class="tags s">${tags.join(' · ')}</div>
  <a class="store" href="${STORE}${esc(item.storePath)}" target="_blank" rel="noopener">View in Kaleidescape store ${icon('ext')}</a>
  <div class="tiles">
    <div class="tile"><div class="tl">Lowest ever</div><div class="tv">${money(st.low)}</div><div class="tn">${esc(listDates(st.lowDates))}</div></div>
    <div class="tile"><div class="tl">Usual sale price</div><div class="tv">${esc(usual.v)}</div><div class="tn">${esc(usual.n)}</div></div>
    <div class="tile"><div class="tl">Price drops</div><div class="tv">${st.drops.length}</div><div class="tn">${esc(since)}</div></div>
    <div class="tile"><div class="tl">Highest</div><div class="tv">${money(st.high)}</div><div class="tn">${esc(highNote)}</div></div>
  </div>
  <h2>Price history</h2>
  <div class="seg">${ranges.map(([l, n]) => `<button data-days="${n}">${l}</button>`).join('')}<button data-days="0" class="on">All</button></div>
  ${legend}
  <div class="chart"><canvas id="chart" role="img" aria-label="Price history chart for ${esc(item.name)}"></canvas></div>
  <script type="application/json" id="chart-data">${JSON.stringify(cd).replace(/</g, '\\u003c')}</script>
  <h2>Changes</h2>
  ${changes.length ? changes.slice(0, 10).map(crow).join('') : '<p class="empty">No price changes recorded yet.</p>'}
  ${changes.length > 10 ? `<details><summary>Show all ${changes.length}</summary>${changes.slice(10).map(crow).join('')}</details>` : ''}
  <p class="note">${hasForum && d.trackerStart
    ? `Before ${esc(shortDate(d.trackerStart))}: from ironcross's posts on kscapeowners.com${isBundle ? ' (sets tracked since Jan 2026)' : ''}. After: this tracker.`
    : `From this tracker${d.trackerStart ? `, since ${esc(shortDate(d.trackerStart))}` : ''}.`}</p>
  <script src="${links.asset('chart.umd.js')}"></script>
  <script src="${links.asset('chart-page.js')}"></script>`;
  return shell(item.name, body);
}

const monthYear = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', year: 'numeric' }).format(new Date(iso));

// ---- Search ----

const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function searchPage(q: string): string {
  const query = q.trim();
  let h = searchHeader();
  h += `<form class="search" action="${links.search()}" method="get" role="search">
    <input type="search" name="q" value="${esc(query)}" placeholder="Wonka, Harry Potter 8-Movie Set" autofocus autocomplete="off" aria-label="Search titles and bundles"></form>`;
  if (query.length >= 2) {
    const f = fold(query);
    const hits = [...getData().items.values()].filter((i) => fold(i.name).includes(f))
      .sort((a, b) => Number(fold(b.name).startsWith(f)) - Number(fold(a.name).startsWith(f)) || a.name.localeCompare(b.name));
    if (!hits.length) h += `<p class="empty">Nothing matches “${esc(query)}”.</p>`;
    for (const item of hits.slice(0, 60)) {
      const meta: string[] = [item.kind === 'bundle' ? `Bundle · ${item.numItems ?? '?'} titles` : item.kind === 'tv' ? `TV · ${item.formatLabel}` : item.formatLabel];
      if (item.onSale && item.saleEnd) meta.push(`<span class="ends">Ends ${esc(monthDay(item.saleEnd))}</span>`);
      const chg = item.onSale && item.regular && item.price !== null && item.regular > item.price
        ? `<span class="chg down">↓ ${money(item.regular - item.price)}</span>` : '';
      h += listRow(item, item.name, meta.join(' · '), item.price, chg);
    }
    if (hits.length > 60) h += `<p class="note">Showing 60 of ${hits.length}. Add more words to narrow it down.</p>`;
  }
  return shell('Search', h);
}

/** Search page top: a back link like the other pages, then the title. */
const searchHeader = () =>
  `<a class="back" href="${links.home()}">${icon('back')}Price Tracker</a><div class="top"><h1>Search</h1></div>`;

/** Static-site search: the same page, filled in the browser from search-index.json by search.js. */
export function staticSearchPage(): string {
  let h = searchHeader();
  h += `<form class="search" role="search" onsubmit="return false">
    <input type="search" id="q" placeholder="Wonka, Harry Potter 8-Movie Set" autofocus autocomplete="off" aria-label="Search titles and bundles"></form>
    <div id="results"></div>
    <script>window.SEARCH_INDEX=${JSON.stringify(links.asset('search-index.json'))};window.STORE=${JSON.stringify(STORE)};</script>
    <script src="${links.asset('search.js')}"></script>`;
  return shell('Search', h);
}

/** Compact list of every title and bundle for static search. */
export function searchIndex(): unknown[] {
  return [...getData().items.values()].map((i) => [
    i.name,
    i.kind === 'bundle' ? `Bundle · ${i.numItems ?? '?'} titles` : i.kind === 'tv' ? `TV · ${i.formatLabel}` : i.formatLabel,
    i.price,
    i.onSale ? i.regular : null,
    i.onSale && i.saleEnd ? monthDay(i.saleEnd) : null,
    i.storePath,
    historyPath(i),
  ]);
}

export function notFoundPage(): string {
  return shell('Not found', `${header('Not found')}<p class="empty">That page doesn't exist. <a href="${links.home()}">Back to the price tracker</a></p>`);
}
