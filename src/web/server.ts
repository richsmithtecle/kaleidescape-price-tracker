// Web app server.
//
//   npm run web          http://localhost:3000 (this Mac only)
//   npm run web:phone    also reachable from your iPhone on the same Wi-Fi
//
// Read-only: it never changes the database.

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { PROJECT_ROOT } from '../db.ts';
import { getData, findItem } from './data.ts';
import { feedPage, dayPage, itemPage, searchPage, notFoundPage } from './pages.ts';

const { values: args } = parseArgs({
  options: { port: { type: 'string', default: '3000' }, lan: { type: 'boolean', default: false } },
});
const PORT = Number(process.env.PORT ?? args.port);
const HOST = args.lan ? '0.0.0.0' : '127.0.0.1';

const STATIC: Record<string, { file: string; type: string }> = {
  '/static/app.css': { file: join(PROJECT_ROOT, 'public', 'app.css'), type: 'text/css; charset=utf-8' },
  '/static/chart-page.js': { file: join(PROJECT_ROOT, 'public', 'chart-page.js'), type: 'text/javascript; charset=utf-8' },
  '/static/search.js': { file: join(PROJECT_ROOT, 'public', 'search.js'), type: 'text/javascript; charset=utf-8' },
  '/static/chart.umd.js': { file: join(PROJECT_ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), type: 'text/javascript; charset=utf-8' },
};

let currentReq: http.IncomingMessage | null = null;
function send(res: http.ServerResponse, status: number, body: string | Buffer, type = 'text/html; charset=utf-8', cache = 'no-cache') {
  const headers: Record<string, string> = { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding' };
  let out = typeof body === 'string' ? Buffer.from(body) : body;
  if (out.length > 1024 && /\bgzip\b/.test(String(currentReq?.headers['accept-encoding'] ?? ''))) {
    out = gzipSync(out);
    headers['Content-Encoding'] = 'gzip';
  }
  res.writeHead(status, headers);
  res.end(out);
}

const handler: http.RequestListener = (req, res) => {
  const started = Date.now();
  currentReq = req;
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;

    const st = STATIC[path];
    if (st) return send(res, 200, readFileSync(st.file), st.type, 'public, max-age=3600');

    if (path === '/') {
      const before = url.searchParams.get('before') ?? undefined;
      return send(res, 200, feedPage(before && /^\d{4}-\d{2}-\d{2}$/.test(before) ? before : undefined));
    }
    if (path === '/search') return send(res, 200, searchPage(url.searchParams.get('q') ?? ''));
    const dm = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
    if (dm) { const page = dayPage(dm[1]); return page ? send(res, 200, page) : send(res, 404, notFoundPage()); }

    const m = path.match(/^\/(title|bundle)\/([^/]+)$/);
    if (m) {
      const item = findItem(m[1] as 'title' | 'bundle', decodeURIComponent(m[2]));
      return item ? send(res, 200, itemPage(item)) : send(res, 404, notFoundPage());
    }
    if (path === '/favicon.ico') return send(res, 204, '');
    return send(res, 404, notFoundPage());
  } catch (err) {
    console.error(err);
    return send(res, 500, 'Something went wrong. Check the server log.', 'text/plain');
  } finally {
    if (Date.now() - started > 500) console.log(`${req.url} took ${Date.now() - started} ms`);
  }
};

getData(); // load once at startup so the first page is fast
// "localhost" can mean 127.0.0.1 or ::1 depending on the browser, so listen on both
// (or on every interface with --lan, so an iPhone on the same Wi-Fi can connect).
if (!args.lan) http.createServer(handler).listen(PORT, '::1').on('error', () => { /* no IPv6: fine */ });
http.createServer(handler).listen(PORT, HOST, () => {
  console.log(`Kaleidescape price tracker: http://localhost:${PORT}`);
  if (args.lan) {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`On your iPhone (same Wi-Fi): http://${a.address}:${PORT}`);
      }
    }
  }
});
