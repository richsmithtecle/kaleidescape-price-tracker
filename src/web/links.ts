// URLs inside the app. The same pages are served two ways:
//   - by the local server (npm run web):  /title/<id>, /?before=<day>, /search?q=
//   - as a static site on GitHub Pages:   <base>/title/<id>/, <base>/older/<day>/, <base>/search/
// configureLinks() switches between them; the local server keeps the defaults.

let base = '';
let isStatic = false;

export function configureLinks(opts: { base?: string; static?: boolean }) {
  base = (opts.base ?? '').replace(/\/+$/, '');
  isStatic = !!opts.static;
}

const dir = (p: string) => `${base}${p}${isStatic ? '/' : ''}`;

export const links = {
  home: () => `${base}/`,
  older: (day: string) => (isStatic ? `${base}/older/${day}/` : `/?before=${day}`),
  day: (day: string) => dir(`/day/${day}`),
  title: (editionId: string) => dir(`/title/${encodeURIComponent(editionId)}`),
  bundle: (bundleId: string | number) => dir(`/bundle/${encodeURIComponent(String(bundleId))}`),
  search: () => dir('/search'),
  asset: (name: string) => `${base}/static/${name}`,
  isStatic: () => isStatic,
  base: () => base,
};
