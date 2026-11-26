// Client for the Kaleidescape Movie Store's JSON API.
// See FINDINGS.md for how these endpoints were found.

const STORE_URL = 'https://www.kaleidescape.com/movie-store/';
const API_BASE = 'https://www.kaleidescape.com/movie-store/rest/';
const USER_AGENT = 'Mozilla/5.0 (compatible; personal-price-tracker/0.1)';

export const COUNTRY = 'US';

export interface Money {
  currency_code: string;
  dollars: number;
  cents: number;
  is_negative: boolean;
}

/** One title as listed in the catalog (rest/packages/all). Only the fields we use. */
export interface CatalogPackage {
  package_id: number;
  movie_id: number;
  movie_edition_id: string;
  movie_edition_uri_name: string;
  title: string;
  season_name?: string | null;
  edition_summary?: string | null;
  base_price: Money | null;      // current price
  est_base_price: Money | null;  // regular purchase price
  rental_price: Money | null;
  media_quality?: string | null;
  audio_codec_type?: string | null;
  is_television?: boolean | null;
  is_preorder?: boolean | null;
  rating?: string | null;
  rt_critic_score?: number | null;
  rt_audience_score?: number | null;
  image_uris?: Record<string, string> | null;
}

export interface CatalogPage {
  num_pages: number;
  packages: CatalogPackage[];
}

/** A sale offer (rest/ownership/packages/est), keyed by package_id. */
export interface SaleOffer {
  package_id: number;
  type: string;          // 'EST-TPR' = temporary price reduction
  price: Money | null;
  window_start: number | null;  // Unix seconds
  window_end: number | null;    // Unix seconds
}

/** A bundle as listed on the Content Sets page. */
export interface BundleListing {
  collection_id: number;
  hard_bundle_id: number;
  display_name: string;
  uri_name: string;                      // e.g. "/set/mcu_spider_man_4_movie_set"
  image_uris?: Record<string, string> | null;
  est_price: Money | null;               // current price
  est_original_price: Money | null;      // set only while on sale
}

/** A bundle's own page (rest/packages/set/<slug>). */
export interface BundleDetail {
  title: string;
  num_items: number;
  hard_bundle: {
    hard_bundle_id: number;
    price: Money | null;
    original_price: Money | null;
    tpr_end: number | null;              // sale end, Unix seconds
  } | null;
  packages: CatalogPackage[];            // the titles in the bundle
}

export function toCents(m: Money | null | undefined): number | null {
  if (!m) return null;
  const c = m.dollars * 100 + m.cents;
  return m.is_negative ? -c : c;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch with retries for network errors, 429 and 5xx. Waits 5s, 15s, then 45s between tries. */
async function fetchWithRetry(url: string, init: RequestInit, label: string): Promise<Response> {
  const delays = [5_000, 15_000, 45_000];
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      const body = (await res.text()).slice(0, 200);
      if (!retryable || attempt >= delays.length) {
        throw new Error(`${label}: HTTP ${res.status} ${body}`);
      }
      console.warn(`${label}: HTTP ${res.status}, retrying in ${delays[attempt] / 1000}s`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith(`${label}: HTTP`)) throw err;
      if (attempt >= delays.length) throw new Error(`${label}: ${String(err)}`);
      console.warn(`${label}: ${String(err)}, retrying in ${delays[attempt] / 1000}s`);
    }
    await sleep(delays[attempt]);
  }
}

export class KaleidescapeClient {
  private version = '';

  /**
   * The API needs the store's current build version in a header. It changes when
   * Kaleidescape deploys, so read it from the store page at the start of each run.
   */
  async init(): Promise<string> {
    const res = await fetchWithRetry(STORE_URL, { headers: { 'User-Agent': USER_AGENT } }, 'store page');
    const html = await res.text();
    const match = html.match(/data-store_version="([^"]+)"/);
    if (!match) throw new Error('Could not find data-store_version on the store page (site layout may have changed)');
    this.version = match[1];
    return this.version;
  }

  private async getJson<T>(path: string, params: Record<string, string | number>, label: string): Promise<T> {
    if (!this.version) throw new Error('Call init() first');
    const url = new URL(path, API_BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetchWithRetry(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'X-Kaleidescape-Application-Id': 'store.js',
        'X-Kaleidescape-Application-Version': this.version,
      },
    }, label);
    return (await res.json()) as T;
  }

  getCatalogPage(page: number): Promise<CatalogPage> {
    return this.getJson<CatalogPage>('packages/all', { page, country_code: COUNTRY }, `catalog page ${page}`);
  }

  /**
   * Every bundle in the store, de-duplicated. The Content Sets page groups bundles into rows
   * ("On Sale", "Trilogies", ...) and one bundle can appear in several rows.
   */
  async getBundleList(): Promise<BundleListing[]> {
    const data = await this.getJson<unknown>(
      'packages/collection/content_sets_master_collection/v2', { country_code: COUNTRY }, 'bundle list',
    );
    const found = new Map<number, BundleListing>();
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        if (typeof obj.hard_bundle_id === 'number' && typeof obj.display_name === 'string') {
          found.set(obj.hard_bundle_id, obj as unknown as BundleListing);
        }
        Object.values(obj).forEach(walk);
      }
    };
    walk(data);
    return [...found.values()];
  }

  getBundle(slug: string): Promise<BundleDetail> {
    return this.getJson<BundleDetail>(`packages/set/${encodeURIComponent(slug)}`, { country_code: COUNTRY }, `bundle ${slug}`);
  }

  /** Every package currently on sale, keyed by package_id (as a string). */
  getSaleOffers(): Promise<Record<string, SaleOffer>> {
    return this.getJson<Record<string, SaleOffer>>(
      'ownership/packages/est',
      { country_code: COUNTRY, is_background_request: 'true' },
      'sale offers',
    );
  }
}
