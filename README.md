# Kaleidescape Price Tracker

Records the price of every title and every bundle ("Content Set") in the Kaleidescape Movie
Store (US) over time, including sale prices and when each sale ends. This is phase 1: the data collector. The web app with
per-title charts and the browser extension come later.

How the store's data was found, and what each field means, is in [FINDINGS.md](FINDINGS.md).

## Requirements
- Node.js 24 or newer. It's installed at `~/.local/node`, and `~/.zshrc` puts it on your PATH.
- Nothing else. The database uses Node's built-in SQLite. TypeScript is only used for
  `npm run typecheck`; Node runs the `.ts` files directly.

## Commands
```bash
npm run collect          # full run: titles + bundles, usually 6-8 minutes
npm run collect:test     # only the first 2 catalog pages (plus bundles)
npm run collect -- --skip-bundles   # titles only
npm run collect -- --skip-titles    # bundles only
npm run stats            # summary: recent runs, totals, sales ending soon, biggest discounts
npm run typecheck        # check the code for type errors
```

## Web app
```bash
npm run web          # http://localhost:3000, on this Mac only
npm run web:phone    # also prints an address to open on your iPhone (same Wi-Fi)
```
- **Price changes** (`/`): each day's changes in ironcross's layout (Decreased, Increased, TV, Bundle,
  Added), biggest changes first. "Show N more" opens the full day (`/day/YYYY-MM-DD`).
- **Price history** (`/title/<edition_id>`, `/bundle/<bundle_id>`): current price, sale end, a store
  button, lowest/usual/highest prices, a chart, and every change. Forum-based changes link to the
  ironcross post they came from.
- **Search** (`/search`).
- The app is read-only, and it picks up new collection runs or forum imports automatically.
- Built for iPhone (17pt/15pt text that follows iOS Text Size, 44pt buttons, dark mode). On the
  iPhone, use Share → Add to Home Screen to open it full screen, like an app.
- `web:phone` makes the app reachable by any device on your home network. It's read-only and
  shows only store prices, but don't run it on public Wi-Fi.
- Code: `src/web/` (server, data, pages) and `public/` (styles and chart script).

## Running on GitHub
The workflow in `.github/workflows/collect.yml` runs the collector at 7:17 AM and 1:17 PM Eastern
(8:17 AM and 2:17 PM during daylight saving time, because GitHub schedules use UTC) and publishes
the web app to GitHub Pages, so no computer needs to stay on. GitHub can start scheduled runs
late, sometimes by hours, when it's busy. That's worst at the top of the hour, hence :17.
- The database is stored in the repository's `data` release as `tracker.db.gz`, not in git.
  Each run downloads it, collects, uploads it again, rebuilds the site and deploys it.
- To build the static site locally: `node src/web/build.ts --base /<repo-name> --out site`.
- To run it now: tap **Check prices now** under the "Updated" time on the site, or use Actions →
  "Collect prices and publish" → Run workflow. Tick "Only rebuild" to publish the site without
  collecting.
- **Check prices now** (`public/refresh.js`) starts the workflow through the GitHub API, shows its
  progress, and reloads the page when the new site is published. The first time on each device it
  asks for a GitHub key: a fine-grained token for this repository only, with Actions: Read and
  write. It's kept in that browser's storage and can only run and cancel workflows. Anyone visiting
  can see that a check is running, but can't start one. The button only appears on the GitHub
  Pages build (`build.ts` reads the repository from `GITHUB_REPOSITORY` or `--repo`).
- If a collection fails, the run is marked failed (GitHub emails you), but anything collected is
  still saved and published.
- To use the latest data on your Mac, download `tracker.db.gz` from the `data` release, unzip it
  and put it at `data/tracker.db`.

## Schedule (macOS)
```bash
scripts/install-schedule.sh     # runs at 3:30 AM and 3:30 PM every day
scripts/uninstall-schedule.sh   # removes it
```
Sales end at 3:00 AM Eastern, so the 3:30 AM run records prices returning to normal.
If the Mac is asleep at a scheduled time, the run happens when it wakes. If it's shut down,
that run is skipped. Output goes to `logs/collect.log`.

Because the project is in `~/Documents`, macOS may ask whether "node" can access your Documents
folder the first time the schedule runs. Allow it, or the run will fail.

## Data
`data/tracker.db` is one SQLite file. You can open it with any SQLite viewer
(for example, DB Browser for SQLite).

| Table / view | What it holds |
|---|---|
| `titles` | One row per title: name, URL slug, format, rating, scores, cover, first/last seen |
| `price_history` | A new row **only when something changes**: current price, regular price, rental price, sale start and end |
| `runs` | One row per run with its status, counts and any error, so gaps are visible |
| `current_prices` (view) | Each title with its latest price |
| `bundles` | One row per bundle: name, URL slug, cover, number of titles, first/last seen |
| `bundle_items` | Which titles are in each bundle (`edition_id` links to `titles`) |
| `bundle_price_history` | Bundle price, regular price, on-sale flag and sale end, recorded when something changes |
| `current_bundle_prices` (view) | Each bundle with its latest price |

Prices are stored as integer cents. Times are stored as ISO timestamps in UTC.

Each `price_history` row means "from `observed_at` onward, the price was this". To chart a title,
draw a step line through its rows.

## Historical data from the forum (2020 onward)
Price changes posted by user **ironcross** in the kscapeowners.com "Movies on Sale..." thread
(https://www.kscapeowners.com/XF/threads/movies-on-sale.3942/) fill in the years before this tracker existed.

- `data/forum/ironcross-posts.json` holds his posts from all 195 pages (1,714 posts, June 2020 to
  Nov 2026). It was saved from the browser while logged in, because the forum limits guest views.
- Import one year at a time. Re-running a year replaces it:
  ```bash
  node src/forum/import.ts --year 2025 --dry-run   # report only
  node src/forum/import.ts --year 2025
  ```
  Each run writes `data/forum/report-<year>.txt`, which lists unmatched names and unparsed lines.
- Tables: `forum_posts` (with a link to each post) and `forum_price_changes`. Each row is one
  posted change with the new price, the old price, the format, and the matched `edition_id` or
  `bundle_id`. Unmatched lines are kept with `edition_id`/`bundle_id` NULL.
- Formats: until about 2025, many titles were sold as separate HD and 4K/HDR versions with
  different prices, and both are linked to the same `edition_id`. Always group or filter by `format`
  when building a title's history.
- Gaps: after big sales, ironcross sometimes attached the price increases as a PDF instead of
  listing them (for example Dec 2024, Jan 2025 and Dec 2025), so some increases are missing.
- Limits: there are no sale end dates, since a sale's end only shows up as a later "Increased" line.
  The data is only as complete as his posting. Some posts attach a PDF instead of listing
  changes, and those can't be imported.
- If any of this is made public, credit ironcross and the forum, and don't republish the posts.

## What it tracks (and doesn't yet)
- It tracks the main package for each title, which is the best format shown in the store
  (usually 4K Cinematic Dolby Vision). Other formats are almost always priced the same.
  They're in the sale data but not stored yet.
- It covers the US store only.
- Bundles: every run reads all bundle prices in one request. A bundle's own page, which lists
  its titles and its sale end date, is fetched only when the bundle is new, has just gone on sale
  or changed sale price, or hasn't been checked for 7 days. The first run fetches all ~336 pages
  (about 12 minutes); later runs usually fetch just a few.
- Hidden sets: Kaleidescape leaves some sets off its Content Sets page (for example The Mummy
  3-Movie Set). Each run also reads the set collections linked from the store's home page (such
  as the current "Content Sets On Sale" row), and keeps checking any set it has seen in the last
  60 days through the set's own page. `bundle-seeds.txt` lists sets to look for that haven't been
  seen yet; `node src/find-sets.ts` searches the store for sets named in ironcross's posts that
  the tracker doesn't know about, and prints slugs to add there.
- It doesn't track "Build Your Bundle" offers (pick N titles for a special price). None were active
  when this was built; they'd come from `rest/promotion/packages`.

## If something breaks
- Check `npm run stats`. The `runs` table shows failed or partial runs and the error.
- An error like `HTTP 400 Missing parameters` means Kaleidescape changed what the API requires.
- An error like `Could not find data-store_version` means the store page changed.
