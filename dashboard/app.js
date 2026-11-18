// Token Radar dashboard (radar-2). Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, filters, a
// per-protocol detail view and the live-token set. No network: every byte
// it shows is in data.js. State lives in the hash, so a view is a link.
(function () {
  'use strict';

  const DATA = window.RADAR;
  if (!DATA) return;
  const app = document.getElementById('board');
  const PAGE = 50;
  const state = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, shown: PAGE };

  // ---- Formatting -------------------------------------------------------

  const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** A dollar amount, shortened past thousands; 'n/a' when there is none. */
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFormat.format(n);
  }

  /** A percent with two decimals and a leading plus when positive. */
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  /** An age in days as years past a year, else days; 'unknown' when absent. */
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function riskLabel(r) {
    if (r === 'lower') return 'Lower risk';
    if (r === 'higher') return 'Higher risk';
    return 'Medium risk';
  }

  // ---- The model, recomputed in the page --------------------------------

  // The page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data
  // are visibly the same arithmetic.
  function impliedOf(row, model) {
    const rawGrowth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    const growthMult = 1 + (growth / 100) * model.growth_weight;
    const age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    const maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    const breadth = model.breadth_base + model.breadth_step * Math.min((row.chains || []).length, model.breadth_chains);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth));
  }

  // ---- DOM helper -------------------------------------------------------

  /** Build an element: attrs name classes, text, HTML, handlers and attributes; then children. */
  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const value = attrs[key];
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      }
    }
    for (const child of kids) {
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach((c) => {
          if (c) node.appendChild(c);
        });
      } else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- The farm plan ----------------------------------------------------
  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the
  // hold and every cost and time. No name is special-cased.

  function chainOf(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }

  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  /** One category rule: the keywords that select it, and the action it writes. Rules are tried in order. */
  const ACTION_RULES = [
    { keys: ['lend', 'cdp', 'collateral'], make: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.` },
    { keys: ['dex', 'yield', 'leveraged farm'], make: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.` },
    { keys: ['bridge'], make: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.` },
    { keys: ['staking', 'restak'], make: (name, capital, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.` },
    { keys: ['perpetual', 'derivative'], make: (name, capital, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.` },
    { keys: ['prediction'], make: (name, capital, chain) => `Fund $${capital} and place one market position on ${name}.` },
    { keys: ['curator', 'allocator'], make: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.` },
    { keys: ['stable'], make: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.` },
    { keys: ['rwa'], make: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.` },
    { keys: ['insurance'], make: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.` },
  ];

  function actionFor(p, capital, chain) {
    const c = (p.category || '').toLowerCase();
    for (const rule of ACTION_RULES) {
      if (rule.keys.some((k) => c.indexOf(k) >= 0)) return rule.make(p.name, capital, chain);
    }
    return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
  }

  function stepText(step) {
    let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  function farmSteps(p) {
    const chain = chainOf(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(p.age_days);
    const gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: 'Before you deposit, check ' + p.name + "'s own page for an audit or a points program and read its terms; skip it if the page names no team, no audit and no program.", cost: 'nothing to check', time: '15 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ].map(stepText);
  }

  function planTotal(p) {
    const capital = capitalFor(p);
    const hold = holdDaysFor(p.age_days);
    const weeks = Math.max(1, Math.round(hold / 7));
    return { capital, gas: 12 + weeks * 2, hold };
  }

  // ---- State in the hash -----------------------------------------------

  function readHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('tab')) state.tab = params.get('tab');
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    const next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---- Filtering and sorting --------------------------------------------

  // The scope filter (watchlist vs early radar) reads the watchlist slugs
  // data.js carries, the same list the board was built from.
  const watchlistSet = new Set();
  if (DATA.watchlist && Array.isArray(DATA.watchlist)) {
    DATA.watchlist.forEach((s) => watchlistSet.add(s));
  }

  function rows() {
    const q = state.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some((c) => c === state.chain)) return false;
      if (state.scope === 'watchlist' && !watchlistSet.has(r.slug)) return false;
      if (state.scope === 'early' && watchlistSet.has(r.slug)) return false;
      if (!q) return true;
      const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    const key = state.sort;
    return list.slice().sort((a, b) => {
      let av;
      let bv;
      if (key === 'name') {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (key === 'tvl') {
        av = a.tvl_usd;
        bv = b.tvl_usd;
      } else if (key === 'growth') {
        av = a.change_7d === null ? -Infinity : a.change_7d;
        bv = b.change_7d === null ? -Infinity : b.change_7d;
      } else if (key === 'age') {
        av = a.age_days === null ? Infinity : a.age_days;
        bv = b.age_days === null ? Infinity : b.age_days;
      } else if (key === 'chains') {
        av = (a.chains || []).length;
        bv = (b.chains || []).length;
      } else {
        av = a.implied_value_usd;
        bv = b.implied_value_usd;
      }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- Renderers ---------------------------------------------------------

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' }),
      ),
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { html: DATA.watchlist_size + ' watchlist protocols, ranked by <em>implied value</em>' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise — and never a prediction that a token will be issued.' }),
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token median' }), el('b', { text: DATA.live_median_multiple === null ? 'n/a' : DATA.live_median_multiple + 'x TVL' })),
      ),
    );
  }

  function spotlight() {
    const top = DATA.rows.slice(0, 5);
    return el('section', { class: 'spot', 'aria-label': 'Top five by implied value' },
      el('h2', { text: 'Top five by implied value' }),
      el('div', { class: 'spot-grid' }, top.map((r) =>
        el('button', { type: 'button', class: 'spot-card', onclick: () => openDetail(r.slug) },
          el('span', { class: 'rank', text: '#' + r.rank }),
          el('b', { text: r.name }),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: fmtUsd(r.tvl_usd) + ' TVL · ' + fmtPct(r.change_7d) }),
        ),
      )),
    );
  }

  function categories() {
    const counts = {};
    DATA.rows.forEach((r) => {
      const c = r.category || 'Other';
      counts[c] = (counts[c] || 0) + 1;
    });
    const top = Object.keys(counts)
      .map((c) => [c, counts[c]])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const max = top.length ? top[0][1] : 1;
    return el('section', { class: 'cats', 'aria-label': 'Protocols by category' },
      el('h2', { text: 'Where the board sits' }),
      top.map((pair) =>
        el('div', { class: 'cat-row' },
          el('span', { text: pair[0] }),
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round((pair[1] / max) * 100)) + '%' })),
          el('span', { class: 'num', text: String(pair[1]) }),
        ),
      ),
    );
  }

  function controls() {
    const cats = Array.from(new Set(DATA.rows.map((r) => r.category || 'Other'))).sort();
    const chainCounts = {};
    DATA.rows.forEach((r) => {
      (r.chains || []).forEach((c) => {
        chainCounts[c] = (chainCounts[c] || 0) + 1;
      });
    });
    const chains = Object.keys(chainCounts)
      .sort((a, b) => chainCounts[b] - chainCounts[a])
      .slice(0, 10);
    const search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', () => {
      state.q = search.value;
      state.shown = PAGE;
      writeHash();
      render();
    });
    const categorySelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map((c) => el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null })),
    );
    categorySelect.addEventListener('change', () => {
      state.category = categorySelect.value;
      state.shown = PAGE;
      writeHash();
      render();
    });
    const chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map((c) => el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null })),
    );
    chainSelect.addEventListener('change', () => {
      state.chain = chainSelect.value;
      state.shown = PAGE;
      writeHash();
      render();
    });
    const preBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: () => { state.tab = 'pre-token'; render(); } });
    const liveBtn = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: () => { state.tab = 'live'; render(); } });
    function scopeBtn(value, label) {
      return el('button', { type: 'button', 'aria-pressed': state.scope === value ? 'true' : 'false', text: label, onclick: () => { state.scope = value; state.shown = PAGE; writeHash(); render(); } });
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), categorySelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, preBtn, liveBtn)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), el('div', { class: 'scope' }, scopeBtn('all', 'All rows'), scopeBtn('watchlist', 'Watchlist'), scopeBtn('early', 'Early radar'))),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }),
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: () => { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null,
      ),
    );
  }

  function boardTable() {
    const list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: () => { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; state.shown = PAGE; writeHash(); render(); } }),
      ));
    }
    const max = list[0].implied_value_usd || 1;
    const page = list.slice(0, state.shown);
    const tbody = el('tbody');
    page.forEach((r) => {
      const growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      const tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => openDetail(r.slug),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
        )),
        el('td', null, el('span', { class: 'risk ' + r.risk, text: riskLabel(r.risk) })),
      );
      tbody.appendChild(tr);
    });
    const panel = el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('chains', 'Chains'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Risk' }),
          )),
          tbody,
        ),
      ),
    );
    if (list.length > state.shown) {
      panel.appendChild(el('button', { class: 'more', type: 'button', text: 'Show 50 more (' + (list.length - state.shown) + ' left)', onclick: () => { state.shown += PAGE; render(); } }));
    }
    return panel;
  }

  function liveTable() {
    const tbody = el('tbody');
    DATA.live.forEach((r) => {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a' }),
        el('td', null, el('span', { class: 'status', text: 'already trades' })),
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Mcap / TVL' }),
            el('th', { scope: 'col', text: 'Token' }),
          )),
          tbody,
        ),
      ),
    );
  }

  function modelPanel() {
    const m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (' + m.breadth_base + ' + 0.025 x min(chains, ' + m.breadth_chains + ')) )',
      ),
      el('p', { text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Breadth counts the chains a protocol runs on, up to four: a record spread over more chains is worth a little more than the same TVL on one. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
      el('p', { class: 'note', text: DATA.live_median_multiple === null ? 'No live-token benchmark is available from this snapshot.' : 'Benchmark: live tokens in this snapshot trade at a median of ' + DATA.live_median_multiple + 'x their TVL. A pre-token row whose implied value sits far above that multiple is the model saying the record is strong, not the market saying a price.' }),
    );
  }

  // ---- Detail dialog -----------------------------------------------------

  const dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => {
    state.selected = null;
    writeHash();
  });

  function riskNote(row) {
    if (row.risk === 'higher') return 'Higher risk: this record is young or moving fast, so the numbers behind its implied value have the least history. Size the farm position small and check the protocol again before adding more.';
    if (row.risk === 'lower') return 'Lower risk: this protocol has run a long time with no token and steady growth, so its record is the most settled on the board. That says nothing about whether a token ever comes.';
    return 'Medium risk: a middling record — old enough to have history, young or volatile enough that the numbers can move. The farm plan below keeps the position small either way.';
  }

  function openDetail(slug) {
    const row = DATA.rows.filter((r) => r.slug === slug)[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    const steps = farmSteps(row);
    const total = planTotal(row);
    const multiple = row.tvl_usd > 0 ? (row.implied_value_usd / row.tvl_usd).toFixed(2) + 'x TVL' : 'n/a';
    const recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.listed_at ? ' · listed ' + row.listed_at : '') }),
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() }),
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: String(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Implied multiple' }), el('b', { class: 'num', text: multiple })),
      ),
      el('p', { class: 'note', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Risk' }),
      el('div', null, el('span', { class: 'risk ' + row.risk, text: riskLabel(row.risk) })),
      el('p', { class: 'risk-note ' + row.risk, text: riskNote(row) }),
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map((s) => {
        const at = s.indexOf(' Cost: ');
        const action = at >= 0 ? s.slice(0, at) : s;
        const tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('div', { class: 'plan-total' }, 'Plan total: ', el('b', { text: '$' + total.capital + ' of capital' }), ' plus about ', el('b', { text: '$' + total.gas + ' of gas' }), ' over ', el('b', { text: total.hold + ' days' }), '. Never pay to claim, and never send funds to an address from a message or an ad.'),
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // ---- Render ------------------------------------------------------------

  function render() {
    app.textContent = '';
    const shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(spotlight());
    shell.appendChild(categories());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    window.__shotReady = true;
  }

  readHash();
  render();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
