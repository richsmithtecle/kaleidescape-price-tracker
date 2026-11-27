// Formatting helpers shared by the web pages.

import { links } from './links.ts';

export const TZ = 'America/New_York';

export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return '$' + (cents / 100).toFixed(2);
}

/** "2026-11-25" in the tracker's time zone (sales end at 3 AM Eastern, so days are Eastern). */
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...o }).format(new Date(iso));

/** "Wednesday, Nov 25" (adds the year if it isn't the current year). */
export function dayHeading(day: string): string {
  const iso = `${day}T12:00:00Z`;
  const thisYear = dayKey(new Date().toISOString()).slice(0, 4);
  return fmt(iso, { weekday: 'long', month: 'short', day: 'numeric', ...(day.startsWith(thisYear) ? {} : { year: 'numeric' }) });
}
/** "Nov 25, 2026" */
export const shortDate = (iso: string) => fmt(iso, { month: 'short', day: 'numeric', year: 'numeric' });
/** "Dec 1" */
export const monthDay = (iso: string) => fmt(iso, { month: 'short', day: 'numeric' });
/** "Fri, Nov 27, 2026 at 2:53 PM ET" */
export function updatedAt(iso: string): string {
  const date = fmt(iso, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = fmt(iso, { hour: 'numeric', minute: '2-digit' });
  return `${date} at ${time} ET`;
}
/** "Tue, Dec 1, 3 AM" */
export const saleEnd = (iso: string) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' });

export type Family = '4K' | 'HD' | 'SD';

/** Video family from one of ironcross's format strings, e.g. "C_DV Atmos", "HD DTS-HD Master 5.1". */
export function familyFromForum(format: string | null): Family | null {
  if (!format) return null;
  const v = format.trim().split(/\s+/)[0].toUpperCase();
  if (/^(C_)?(DV|HDR|SDR|UHD|4K)$/.test(v)) return '4K';
  if (v === 'HD') return 'HD';
  if (v === 'SD') return 'SD';
  return null;
}

/** Short label from a forum format: "C_DV Atmos" -> "Cinematic DV Atmos", "HD DTS-HD Master 5.1" -> "HD". */
export function labelFromForum(format: string | null): string {
  if (!format) return '';
  const [video, ...rest] = format.trim().split(/\s+/);
  const map: Record<string, string> = { C_DV: 'Cinematic DV', C_HDR: 'Cinematic HDR', DV: 'DV', HDR: 'HDR', SDR: '4K SDR', UHD: '4K', HD: 'HD', SD: 'SD' };
  const v = map[video.toUpperCase()] ?? video;
  return /atmos/i.test(rest.join(' ')) ? `${v} Atmos` : v;
}

/** Store media_quality, e.g. "UHD_CINEMATIC_DV5" -> family + label. */
export function fromMediaQuality(q: string | null, audio: string | null): { family: Family; label: string } {
  const m: Record<string, [Family, string]> = {
    UHD_CINEMATIC_DV5: ['4K', 'Cinematic DV'], UHD_CINEMATIC_HDR: ['4K', 'Cinematic HDR'], UHD_CINEMATIC_SDR: ['4K', 'Cinematic 4K'],
    UHD_DV5: ['4K', 'DV'], UHD_HDR: ['4K', 'HDR'], UHD: ['4K', '4K'], BLURAY_QUALITY: ['HD', 'HD'],
  };
  const [family, label] = m[q ?? ''] ?? (q?.startsWith('UHD') ? ['4K', '4K'] : q ? ['SD', 'SD'] : ['4K', '']);
  return { family, label: audio === 'ATMOS' && label ? `${label} Atmos` : label };
}

export function pageShell(title: string, body: string, extraHead = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="K Prices">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1f1f1f" media="(prefers-color-scheme: dark)">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${links.asset('app.css')}">
${extraHead}
</head>
<body><main>${body}</main></body>
</html>`;
}
