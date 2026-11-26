# Kaleidescape Movie Store: site investigation (2026-11-26)

## Summary
The store is a single-page app backed by a JSON REST API at
`https://www.kaleidescape.com/movie-store/rest/`. Every title's price, regular price, format
and sale window is available as structured JSON. A full run takes about **128 requests**.

Approach chosen: **direct API calls** (approved by the owner on 2026-11-26).

## Required request headers
The API returns `400 Missing parameters` unless both of these headers are present. They are the
same ones the store's own JavaScript sends; no login, cookie or key is needed.

```
X-Kaleidescape-Application-Id: store.js
X-Kaleidescape-Application-Version: <data-store_version from the store page>   # e.g. 2026.11-301978
Accept: application/json
```

The version changes when Kaleidescape deploys a new store build. At the start of each run, the
scraper should read `data-store_version="..."` from `https://www.kaleidescape.com/movie-store/`
rather than hard-coding it.

## robots.txt
`User-agent: *` with no Disallow rules. The legal/terms page (kaleidescape.com/go/legal) has not
been reviewed yet.

## Endpoints (US store), all verified with direct calls

| Purpose | Endpoint | Notes |
|---|---|---|
| Full catalog | `rest/packages/all?page=N&country_code=US` | 120 titles/page, `num_pages` = 127 (~15k titles), ~160 KB/page, ~3 s |
| **All active sales** | `rest/ownership/packages/est?country_code=US&is_background_request=true` | One call, ~1.2 MB. Keyed by `package_id` |
| Slug → edition id | `rest/movie/edition/<uri_name>?country_code=US` | Returns just the id string |
| Title detail | `rest/movie/edition/id/<movie_edition_id>?country_code=US` | Per-format packages, synopsis, cast and so on |

### Catalog item fields (`packages[]` in `packages/all`)
- `package_id`, `movie_id`, `movie_edition_id`, `movie_edition_uri_name`, `title`
- `base_price`: current price. `est_base_price`: regular purchase price. `rental_price`.
- `media_quality` (best format, e.g. `UHD_CINEMATIC_DV5`), `audio_codec_type`, `is_television`,
  `is_preorder`, `rating`, `rt_critic_score`, `rt_audience_score`, cover `image_uris`
- Prices are `{currency_code, dollars, cents}`. Store them as integer cents.

### Sale offers (`ownership/packages/est`)
An object keyed by `package_id`:
```json
{"package_id":50872598,"type":"EST-TPR","price":{"dollars":24,"cents":99,...},
 "window_start":1795075200,"window_end":1796284800,"license_id":110}
```
- `window_start` and `window_end` are Unix timestamps (UTC). `window_end` 1796284800 is
  Dec 3 2026 03:00 Eastern, which matches the page text "Expires December 3rd at 3:00 AM".
- On 2026-11-26 it held 5,639 packages, all `EST-TPR`. Sales ended on Dec 1 (1,901), Dec 2 (3,115),
  Dec 3 (320), Dec 9 (91), Dec 28 (33), Dec 30 (79) and Jan 5 (100). This confirms staggered end dates.
- Packages are per format, so one title can have several entries (DV5, HDR, SDR, HD, and so on).
  The catalog's `package_id` is the title's main (best-format) package.

## Bundles ("Content Sets"), added 2026-11-26

| Purpose | Endpoint | Notes |
|---|---|---|
| All bundles with prices | `rest/packages/collection/content_sets_master_collection/v2?country_code=US` | ~650 KB. Bundles are grouped into rows (On Sale, Trilogies, Television, ...) and repeat across rows, so de-duplicate by `hard_bundle_id`. 336 unique on 2026-11-26 |
| One bundle | `rest/packages/set/<slug>?country_code=US` | ~7 KB. `hard_bundle.{price, original_price, tpr_end}` plus `packages[]`, the titles in the set |

- In the listing, each bundle has `hard_bundle_id`, `collection_id`, `display_name`,
  `uri_name` (`/set/<slug>`), `est_price` and `est_original_price`.
- `est_original_price` is only set while the bundle is on sale; otherwise it's `null`.
  On 2026-11-26, 138 bundles were on sale and 198 were not.
- The sale end is only on the bundle's own page: `hard_bundle.tpr_end`, in Unix seconds.
  For example, the MCU Spider-Man 4-Movie Set has 1796112000, which is Dec 1 3 AM Eastern and
  matches the page's "Expires December 1st".
- `content_sets_master_collection` (without `/v2`) returns an empty list.
- "Build Your Bundle" offers (soft bundles) would come from `rest/promotion/packages`, which
  returned `{"bundles":{},"bundle_prices":{}}` (none active).

## Scrape plan
1. GET the store page and read `data-store_version`.
2. Walk `packages/all` pages 1..`num_pages` with a polite delay of about 2 s, so roughly 5 minutes in total.
3. GET `ownership/packages/est` once to get every active sale with its start and end time.
4. Compare with the last stored values, and insert a price row only when price, regular price or
   sale window changed.
5. Run twice a day. Sales end at 08:00 UTC (3 AM Eastern), so a run shortly after that catches
   price reversions promptly.

## Environment note
This Mac has no Python yet: `python3` asks to install Xcode Command Line Tools. Install those
(or Homebrew Python) before building. `jq` and `curl` are available.
