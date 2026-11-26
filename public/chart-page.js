// Draws the price-history step chart on title and bundle pages.
// Data comes from <script type="application/json" id="chart-data">.
(function () {
  const el = document.getElementById('chart-data');
  const canvas = document.getElementById('chart');
  if (!el || !canvas || !window.Chart) return;
  const data = JSON.parse(el.textContent);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const ink = css('--chart-ink'), grid = css('--chart-grid'), blue = css('--chart-blue'), gray = css('--chart-gray');
  const day = 864e5;

  const datasets = data.series.map((s, i) => ({
    label: s.label,
    data: s.points.map(([x, y]) => ({ x, y })),
    borderColor: i === 0 ? blue : gray,
    backgroundColor: i === 0 ? blue + '1a' : 'transparent',
    borderDash: i === 0 ? [] : [5, 4],
    fill: i === 0,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0,
  }));
  const maxY = Math.max(...data.series.flatMap((s) => s.points.map((p) => p[1])));
  const step = maxY > 200 ? 100 : maxY > 80 ? 50 : 10;

  const chart = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          title: (i) => new Date(i[0].parsed.x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          label: (i) => (data.series.length > 1 ? i.dataset.label + ' ' : '') + '$' + i.parsed.y.toFixed(2),
        } },
      },
      scales: {
        x: { type: 'linear', min: data.start, max: data.end, grid: { display: false },
          ticks: { color: ink, font: { size: 13 }, maxTicksLimit: 5,
            callback: (v) => new Date(v).toLocaleDateString('en-US', data.end - data.start > 400 * day ? { month: 'short', year: '2-digit' } : { month: 'short' }) } },
        y: { min: 0, suggestedMax: Math.ceil(maxY / step) * step, grid: { color: grid },
          ticks: { color: ink, font: { size: 13 }, stepSize: step, callback: (v) => '$' + v } },
      },
    },
  });

  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    const d = Number(b.dataset.days);
    chart.options.scales.x.min = d ? Math.max(data.start, data.end - d * day) : data.start;
    chart.update();
  }));
})();
