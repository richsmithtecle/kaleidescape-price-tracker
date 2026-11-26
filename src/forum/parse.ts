// Parses ironcross's price-change posts from the kscapeowners.com "Movies on Sale..." thread.
//
// Typical lines:
//   • $9.99 Wonka (2023) DV Atmos ↓ $10.00                    title, now $9.99, down $10
//   • $14.99 Euphoria (Season 1) (2019) HD Other ↓ $10.00     TV season
//   • $39.99 MCU Spider-Man 4-Movie Set ↓ $15.00              bundle
//   • $44.99 Focker 4-Movie Set                                bundle listed with no change (e.g. "Bundle Added")
// Lines sit under headings such as "Decreased", "TV Increased", "Bundle Added".

export interface ParsedChange {
  line_no: number;
  section: string | null;
  kind: 'title' | 'bundle';
  direction: 'down' | 'up' | 'listed';
  name: string;
  year: number | null;
  format: string | null;
  price_cents: number;
  change_cents: number | null;
  old_price_cents: number | null;
  raw: string;
}

const toCents = (s: string) => {
  const [d, c = '0'] = s.replace(/,/g, '').split('.');
  return Number(d) * 100 + Number(c.padEnd(2, '0').slice(0, 2));
};

// $price  rest  [arrow $change]  [junk such as a stray backslash]
const LINE = /^[•*\-\s]*\$([\d,]+(?:\.\d{1,2})?)\s+(.+?)(?:\s*([↓↑])\s*\$([\d,]+(?:\.\d{1,2})?))?\s*\\?\s*$/;

// Video format token that starts the trailing "format audio" part.
const FORMAT_START = /\s((?:C_)?(?:DV|HDR|SDR|UHD|HD|SD|4K)(?:\s.*)?)$/;
const BUNDLE = /\b\d+-(?:Movie|Film|Season|Series|Episode|Volume|Disc|Concert|Title)s?\s+(?:Set|Collection)\b|\bSet\b\s*(?:(?:HD|SD|UHD|HDR|DV)\b.*)?$/i;

export function parsePost(text: string): { changes: ParsedChange[]; skipped: string[] } {
  const changes: ParsedChange[] = [];
  const skipped: string[] = [];
  let section: string | null = null;

  text.split('\n').forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    const m = line.match(LINE);
    if (!m) {
      if (/\$\d/.test(line)) skipped.push(line);          // looked like a price but didn't parse
      else if (line.length <= 40) section = line;          // short non-price line = heading
      return;
    }
    const [, priceStr, body, arrow, changeStr] = m;
    const price = toCents(priceStr);
    const change = changeStr ? toCents(changeStr) : null;
    const direction = arrow === '↓' ? 'down' : arrow === '↑' ? 'up' : 'listed';

    let name = body.trim();
    let format: string | null = null;
    let year: number | null = null;

    const isBundle = BUNDLE.test(name) || /bundle|bundel|\bset\b/i.test(section ?? '');

    // "Title (2019) HDR Atmos": the year in parentheses splits the name from the format.
    const yearSplit = name.match(/^(.*)\((\d{4})\)\s*(.*)$/);
    if (yearSplit && !isBundle) {
      year = Number(yearSplit[2]);
      // Occasionally the year is posted twice: "The Garfield Movie (2024) (2024)"
      name = yearSplit[1].trim().replace(new RegExp(`\\s*\\(${year}\\)$`), '');
      format = yearSplit[3].trim() || null;
    } else {
      const f = name.match(FORMAT_START);
      if (f && (isBundle || !yearSplit)) {
        format = f[1].trim();
        name = name.slice(0, f.index).trim();
      }
    }

    changes.push({
      line_no: i,
      section,
      kind: isBundle ? 'bundle' : 'title',
      direction,
      name,
      year,
      format,
      price_cents: price,
      change_cents: change,
      old_price_cents: change === null ? null : direction === 'down' ? price + change : price - change,
      raw: line,
    });
  });

  return { changes, skipped };
}
