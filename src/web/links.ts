// URLs inside the app. The same pages are served two ways:
//   - by the local server (npm run web):  /title/<id>, /?before=<day>, /search?q=
//   - as a static site on GitHub Pages:   <base>/title/<id>/, <base>/older/<day>/, <base>/search/
// configureLinks() switches between them; the local server keeps the defaults.

let base = '';
let isStatic = false;
let repo = '';
// Changes on every server start or site build, so browsers (and iPhone home-screen apps)
// fetch updated styles and scripts instead of using a cached copy.
const version = Date.now().toString(36);

export function configureLinks(opts: { base?: string; static?: boolean; repo?: string }) {
  base = (opts.base ?? '').replace(/\/+$/, '');
  isStatic = !!opts.static;
  repo = /^[\w.-]+\/[\w.-]+$/.test(opts.repo ?? '') ? opts.repo! : '';
}

const dir = (p: string) => `${base}${p}${isStatic ? '/' : ''}`;

export const links = {
  home: () => `${base}/`,
  older: (day: string) => (isStatic ? `${base}/older/${day}/` : `/?before=${day}`),
  day: (day: string) => dir(`/day/${day}`),
  title: (editionId: string) => dir(`/title/${encodeURIComponent(editionId)}`),
  bundle: (bundleId: string | number) => dir(`/bundle/${encodeURIComponent(String(bundleId))}`),
  search: () => dir('/search'),
  asset: (name: string) => `${base}/static/${name}${name.endsWith('.json') ? '' : `?v=${version}`}`,
  isStatic: () => isStatic,
  base: () => base,
  /** GitHub "owner/name" the static site was built from, or '' (local server). */
  repo: () => repo,
};
