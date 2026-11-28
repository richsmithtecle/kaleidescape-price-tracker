// "Check prices now" on the GitHub Pages site.
//
// Tapping it starts the "Collect prices and publish" workflow through the GitHub API, then shows
// its progress until the new site is published, and reloads the page. Starting a run needs a
// GitHub key (a fine-grained token limited to this repository, Actions: read and write), which the
// owner pastes in once per device; it's kept in this browser only. Anyone can see that a check is
// running, because the repository is public.
(() => {
  const root = document.getElementById('refresh');
  if (!root) return;
  const repo = root.dataset.repo;
  const workflow = root.dataset.workflow;
  const API = `https://api.github.com/repos/${repo}/actions`;
  const KEY = 'kpt-github-key';
  const RUN = 'kpt-run';
  const POLL_MS = 10000;
  const TYPICAL_MIN = 8;

  const btn = root.querySelector('.refresh-btn');
  const label = root.querySelector('.refresh-label');
  const status = root.querySelector('.refresh-status');
  const form = root.querySelector('.refresh-setup');
  const keyInput = root.querySelector('.refresh-key');

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: lasts for this page only */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  let memKey = null;
  const getKey = () => store.get(KEY) ?? memKey;

  const [owner, name] = repo.split('/');
  const keyUrl = 'https://github.com/settings/personal-access-tokens/new?' + new URLSearchParams({
    name: 'Kaleidescape price check', description: `Lets the price tracker site start a price check (${repo}).`,
    target_name: owner, expires_in: '365', actions: 'write',
  });
  root.querySelector('.refresh-keylink').href = keyUrl;

  // After a check finishes the page reloads with ?updated=…, which skips the browser's cached copy.
  if (new URLSearchParams(location.search).has('updated')) {
    history.replaceState(null, '', location.pathname + location.hash);
  }

  // ---- GitHub API ----
  async function api(path, opts = {}) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const key = getKey();
    if (key) headers.Authorization = `Bearer ${key}`;
    if (opts.body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(`${API}${path}`, { ...opts, headers, cache: 'no-store' });
    } catch {
      throw Object.assign(new Error("Couldn't reach GitHub. Check your connection and try again."), { kind: 'network' });
    }
    if (res.status === 401) throw Object.assign(new Error('GitHub didn’t accept the key. It may have expired.'), { kind: 'key' });
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      throw Object.assign(new Error('GitHub is limiting requests right now. Try again in a few minutes.'), { kind: 'limit' });
    }
    if (res.status === 403 || res.status === 404) {
      throw Object.assign(new Error(`The key isn’t allowed to run checks for ${name}.`), { kind: 'key' });
    }
    if (!res.ok) throw Object.assign(new Error(`GitHub returned an error (${res.status}). Try again later.`), { kind: 'other' });
    return res.status === 204 ? null : res.json();
  }

  const activeRuns = async () => {
    const r = await api(`/workflows/${workflow}/runs?per_page=5`);
    return (r?.workflow_runs ?? []).filter((x) => x.status !== 'completed');
  };

  async function startRun() {
    const since = Date.now() - 30000;
    const r = await api(`/workflows/${workflow}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: 'main', inputs: { skip_collect: false }, return_run_details: true }),
    });
    if (r?.workflow_run_id) return r.workflow_run_id;
    // Older API: no run id in the reply, so find the run that just appeared.
    for (let i = 0; i < 6; i++) {
      await sleep(2500);
      const list = await api(`/workflows/${workflow}/runs?event=workflow_dispatch&per_page=3`);
      const run = (list?.workflow_runs ?? []).find((x) => Date.parse(x.created_at) >= since);
      if (run) return run.id;
    }
    throw Object.assign(new Error('The check was started, but its progress couldn’t be found.'), { kind: 'other' });
  }

  // What the run is doing now, in plain words.
  async function stepName(run) {
    if (run.status === 'queued' || run.status === 'pending') return 'Waiting for GitHub to start it';
    if (run.status === 'waiting') return 'Publishing the site';  // the Pages deployment step
    if (!getKey()) return 'Checking prices';  // job details need the key's rate limit
    try {
      const jobs = (await api(`/runs/${run.id}/jobs`))?.jobs ?? [];
      if (jobs.some((j) => j.name === 'deploy' && j.status !== 'completed' && j.status !== 'queued')) return 'Publishing the site';
      const step = jobs.flatMap((j) => j.steps ?? []).find((s) => s.status === 'in_progress')?.name ?? '';
      if (/download/i.test(step)) return 'Getting ready';
      if (/collect/i.test(step)) return 'Checking prices';
      if (/save|build|upload|schedule/i.test(step)) return 'Building the site';
      if (/deploy/i.test(step)) return 'Publishing the site';
      return jobs.length ? 'Checking prices' : 'Getting ready';
    } catch {
      return 'Checking prices';
    }
  }

  // ---- Display ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtElapsed = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  function setStatus(text, link) {
    status.textContent = text;
    if (link) {
      status.append(' ');
      const a = document.createElement('a');
      a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Details';
      status.append(a);
    }
  }
  function setBusy(on, text) {
    root.classList.toggle('busy', on);
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    label.textContent = text ?? 'Check prices now';
  }
  function showSetup(message) {
    setBusy(false);
    setStatus(message ?? '');
    form.hidden = false;
    btn.hidden = true;
    keyInput.focus();
  }
  function hideSetup() {
    form.hidden = true;
    btn.hidden = false;
  }
  function fail(err) {
    setBusy(false);
    root.classList.remove('done');
    if (err.kind === 'key') {
      store.del(KEY); memKey = null;
      showSetup(`${err.message} Paste a new key to continue.`);
    } else {
      setStatus(err.message);
    }
  }

  // ---- Following a run until it's published ----
  let ticker = null;
  async function follow(runId, startedAt) {
    store.set(RUN, JSON.stringify({ id: runId, startedAt }));
    let step = 'Starting', url = null;
    const paint = () => {
      setBusy(true, `Updating… ${fmtElapsed(Date.now() - startedAt)}`);
      setStatus(`${step} · usually takes about ${TYPICAL_MIN} minutes`, url);
    };
    clearInterval(ticker);
    ticker = setInterval(paint, 1000);
    paint();
    try {
      for (;;) {
        const run = await api(`/runs/${runId}`);
        url = run.html_url;
        if (run.status === 'completed') {
          clearInterval(ticker);
          store.del(RUN);
          if (run.conclusion === 'success') {
            root.classList.add('done');
            setBusy(true, 'Prices checked');
            setStatus('Loading the new prices…');
            await sleep(1500);
            location.replace(`${location.pathname}?updated=${Date.now()}`);
          } else if (run.conclusion === 'cancelled') {
            setBusy(false);
            setStatus('The check was cancelled.', url);
          } else {
            setBusy(false);
            setStatus('The check didn’t finish. Anything it collected is still saved.', url);
          }
          return;
        }
        step = await stepName(run);
        paint();
        await sleep(getKey() ? POLL_MS : POLL_MS * 2);  // GitHub allows fewer requests without a key
      }
    } catch (err) {
      clearInterval(ticker);
      if (err.kind !== 'key') store.del(RUN);
      fail(err);
    }
  }

  async function check() {
    hideSetup();
    if (!getKey()) return showSetup();
    setBusy(true, 'Starting…');
    setStatus('Contacting GitHub…');
    try {
      // If a scheduled (or earlier) check is already running, follow it instead of queueing another.
      const running = (await activeRuns())[0];
      if (running) {
        setStatus('A check is already running.');
        return follow(running.id, Date.parse(running.run_started_at ?? running.created_at));
      }
      const id = await startRun();
      follow(id, Date.now());
    } catch (err) {
      fail(err);
    }
  }

  btn.addEventListener('click', check);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = keyInput.value.trim();
    if (!/^(github_pat_|ghp_)\w{20,}$/.test(key)) {
      setStatus('That doesn’t look like a GitHub key. It starts with github_pat_.');
      return;
    }
    memKey = key;
    store.set(KEY, key);
    keyInput.value = '';
    check();
  });
  root.querySelector('.refresh-cancel').addEventListener('click', () => { hideSetup(); setStatus(''); });

  root.hidden = false;

  // On load: pick up a check this device started, or show one that's running anyway.
  (async () => {
    let saved = null;
    try { saved = JSON.parse(store.get(RUN) ?? 'null'); } catch { /* ignore */ }
    if (saved?.id && Date.now() - saved.startedAt < 60 * 60000) return follow(saved.id, saved.startedAt);
    store.del(RUN);
    try {
      const running = (await activeRuns())[0];
      if (running) follow(running.id, Date.parse(running.run_started_at ?? running.created_at));
    } catch { /* not important enough to show */ }
  })();
})();
