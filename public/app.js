import { searchPins } from './api.js';
import { appendCards, getActivePin } from './cards.js';
import { shelf } from './shelf.js';
import * as layers from './layers.js';
import { initShelf, isComparing, closeCompare } from './shelf-ui.js';
import { initPeek, isPeeking, hide as hidePeek } from './peek.js';

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');
const moreBtn = document.getElementById('more');
const sentinel = document.getElementById('sentinel');

const state = { query: '', bookmark: null, loading: false, done: false };
// True while replaying a history entry, so we don't push new ones as we go.
let restoring = false;

function setStatus(text) {
  statusEl.textContent = text || '';
  statusEl.hidden = !text;
}

/* ---------- search grid ---------- */

async function loadResults({ reset = false } = {}) {
  if (state.loading || (state.done && !reset)) return;
  state.loading = true;
  moreBtn.hidden = true;

  if (reset) {
    grid.replaceChildren();
    state.bookmark = null;
    state.done = false;
  }
  setStatus(reset ? 'Searching…' : 'Loading more…');

  try {
    const data = await searchPins(state.query, state.bookmark);
    // A newer search may have started while this was in flight.
    if (data.query !== state.query) return;

    appendCards(grid, data.pins, { onOpen: openLayer });
    state.bookmark = data.bookmark;
    state.done = !data.bookmark;

    if (!grid.childElementCount) setStatus(`No results for “${state.query}”.`);
    else setStatus(state.done ? 'End of results.' : '');
    moreBtn.hidden = state.done;
  } catch (err) {
    setStatus(err.message);
    moreBtn.hidden = !grid.childElementCount && !state.bookmark;
  } finally {
    state.loading = false;
  }
}

function runSearch(query) {
  state.query = query;
  input.value = query;
  document.title = query ? `${query} · pint` : 'pint';

  if (!query) {
    grid.replaceChildren();
    moreBtn.hidden = true;
    state.bookmark = null;
    state.done = false;
    setStatus('Search for something to start. Hold Space to peek, S to shelf.');
    return Promise.resolve();
  }
  return loadResults({ reset: true });
}

/* ---------- layers ---------- */

function openLayer(pin) {
  layers.open(pin);
}

layers.initLayers({
  root: document.getElementById('layers'),
  rail: document.getElementById('rail'),
  backdrop: document.getElementById('backdrop'),
  onChange: () => {
    if (!restoring) pushState();
  },
});

/* ---------- history ---------- */

function currentUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  const trail = layers.chain();
  if (trail.length) params.set('pin', trail.join(','));
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}

function snapshot() {
  return { q: state.query, chain: layers.chain() };
}

function pushState() {
  history.pushState(snapshot(), '', currentUrl());
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  return {
    q: (params.get('q') || '').trim(),
    chain: (params.get('pin') || '').split(',').filter(Boolean),
  };
}

/** Replay a history entry: get the query right first, then the layer trail. */
async function restore(target) {
  restoring = true;
  try {
    if (target.q !== state.query) await runSearch(target.q);
    await layers.setChain(target.chain || []);
  } finally {
    restoring = false;
  }
}

addEventListener('popstate', (event) => {
  restore(event.state || readUrl());
});

/* ---------- shelf + peek ---------- */

initShelf({
  bar: document.getElementById('shelf'),
  compare: document.getElementById('compare'),
  onOpen: openLayer,
});
initPeek();

/* ---------- input wiring ---------- */

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query || query === state.query) return;
  layers.closeAll();
  runSearch(query).then(pushState);
});

moreBtn.addEventListener('click', () => loadResults());

// Infinite scroll for the results grid; paused while a layer covers it.
new IntersectionObserver(
  (entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    if (layers.isOpen() || !state.query || state.done) return;
    loadResults();
  },
  { rootMargin: '600px' },
).observe(sentinel);

addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea')) {
    if (event.key === 'Escape') event.target.blur();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  switch (event.key) {
    case 'Escape':
      // Unwind the shallowest thing that's open first.
      if (isComparing()) closeCompare();
      else if (isPeeking()) hidePeek();
      else if (layers.isOpen()) layers.pop();
      break;
    case 'Backspace':
      if (layers.isOpen()) {
        event.preventDefault();
        layers.pop();
      }
      break;
    case 's':
    case 'S': {
      const pin = getActivePin();
      if (pin) shelf.toggle(pin);
      break;
    }
    case '/':
      event.preventDefault();
      input.focus();
      input.select();
      break;
    default:
      break;
  }
});

/* ---------- boot ---------- */

const initial = readUrl();
history.replaceState({ q: initial.q, chain: initial.chain }, '', currentUrl());
restore(initial).then(() => history.replaceState(snapshot(), '', currentUrl()));
