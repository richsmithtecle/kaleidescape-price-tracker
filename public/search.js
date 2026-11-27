// Search for the static (GitHub Pages) site. Loads a compact index of every title and
// bundle once, then filters as you type. Rows match the server-rendered search page.
(function () {
  const input = document.getElementById('q');
  const out = document.getElementById('results');
  if (!input || !out) return;
  const fold = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const money = (c) => (c == null ? '—' : '$' + (c / 100).toFixed(2));
  let index = null, folded = null;

  function render() {
    const q = input.value.trim();
    const url = new URL(location.href);
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
    if (!index || q.length < 2) { out.innerHTML = index || q.length < 2 ? '' : '<p class="empty">Loading…</p>'; return; }
    const f = fold(q);
    const hits = [];
    for (let i = 0; i < index.length; i++) if (folded[i].includes(f)) hits.push(i);
    hits.sort((a, b) => Number(folded[b].startsWith(f)) - Number(folded[a].startsWith(f)) || index[a][0].localeCompare(index[b][0]));
    if (!hits.length) { out.innerHTML = `<p class="empty">Nothing matches “${esc(q)}”.</p>`; return; }
    out.innerHTML = hits.slice(0, 60).map((i) => {
      const [name, meta, price, regular, ends, store, hist] = index[i];
      const m = [esc(meta)];
      if (ends) m.push(`<span class="ends">Ends ${esc(ends)}</span>`);
      const chg = regular && price != null && regular > price ? `<span class="chg down">↓ ${money(regular - price)}</span>` : '';
      return `<div class="row"><div class="left"><a class="name" href="${window.STORE}${esc(store)}" target="_blank" rel="noopener">${esc(name)}</a><div class="meta">${m.join(' · ')}</div></div>
        <a class="pricecol" href="${esc(hist)}" aria-label="Price history for ${esc(name)}, ${money(price)}"><span class="price">${money(price)}</span>${chg}</a></div>`;
    }).join('') + (hits.length > 60 ? `<p class="note">Showing 60 of ${hits.length}. Add more words to narrow it down.</p>` : '');
  }

  input.value = new URL(location.href).searchParams.get('q') || '';
  input.addEventListener('input', render);
  fetch(window.SEARCH_INDEX).then((r) => r.json()).then((data) => {
    index = data;
    folded = data.map((r) => fold(r[0]));
    render();
  }).catch(() => { out.innerHTML = '<p class="empty">Search could not load. Try again later.</p>'; });
  render();
})();
