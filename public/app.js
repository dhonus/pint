import { searchPins } from './api.js';
import { createCard, getActivePin } from './cards.js';
import { createMasonry } from './masonry.js';
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
const spinner = document.getElementById('loading');

const state = { query: '', bookmark: null, loading: false, done: false };
const masonry = createMasonry(grid, { gap: 16, minColumn: 240 });
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
    masonry.clear();
    state.bookmark = null;
    state.done = false;
  }
  setStatus('');
  spinner.hidden = false;

  try {
    const data = await searchPins(state.query, state.bookmark);
    // A newer search may have started while this was in flight.
    if (data.query !== state.query) return;

    masonry.append(data.pins, (pin) => createCard(pin, { onOpen: openLayer }));
    state.bookmark = data.bookmark;
    state.done = !data.bookmark;

    if (!masonry.count()) setStatus(`No results for “${state.query}”.`);
    else setStatus(state.done ? 'End of results.' : '');
    // The grid loads itself; this is only a retry affordance after a failure.
    moreBtn.hidden = true;
  } catch (err) {
    setStatus(err.message);
    moreBtn.hidden = false;
  } finally {
    state.loading = false;
    spinner.hidden = true;
    rearmGrid();
  }
}

function runSearch(query) {
  state.query = query;
  input.value = query;
  document.title = query ? `${query} · pint` : 'pint';

  if (!query) {
    masonry.clear();
    moreBtn.hidden = true;
    spinner.hidden = true;
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
  // Closing the layers is part of this one navigation, not a separate one.
  restoring = true;
  layers.closeAll();
  restoring = false;
  runSearch(query).then(pushState);
});

moreBtn.addEventListener('click', () => loadResults());

// Infinite scroll for the results grid; paused while a layer covers it.
const gridObserver = new IntersectionObserver(
  (entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    if (layers.isOpen() || !state.query || state.done) return;
    loadResults();
  },
  { rootMargin: '600px' },
);
gridObserver.observe(sentinel);

/**
 * An observer only reports *changes* in intersection. After a batch lands the
 * sentinel is usually still inside the margin, so it never fires again and
 * loading stalls. Re-observing forces a fresh report of the current state.
 */
function rearmGrid() {
  if (state.done) return;
  gridObserver.unobserve(sentinel);
  requestAnimationFrame(() => gridObserver.observe(sentinel));
}

// A keydown can target `document` or `window`, which have no `.matches`.
const isTyping = (target) =>
  target instanceof Element && target.matches('input, textarea, [contenteditable]');

/** Whichever surface is on top is the one the arrow keys should walk. */
function selectable() {
  if (isComparing()) return [...document.querySelectorAll('.compare-item .shelf-open')];
  const top = layers.topElement();
  if (top) return [...top.querySelectorAll('.sub-grid .card-open')];
  return [...grid.querySelectorAll('.card-open')];
}

/**
 * Move by geometry rather than DOM order: masonry columns mean the next element
 * in the document is rarely the one that looks like it's next to you.
 */
function moveSelection(direction) {
  const items = selectable();
  if (!items.length) return;

  const index = items.indexOf(document.activeElement);
  if (index === -1) {
    items[0].focus();
    return;
  }

  const from = items[index].getBoundingClientRect();
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;

  let best = null;
  let bestScore = Infinity;
  items.forEach((el, i) => {
    if (i === index) return;
    const rect = el.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - fromX;
    if (direction === 'right' ? dx <= 4 : dx >= -4) return;
    // Weight vertical drift so it prefers something on roughly the same line.
    const score = Math.abs(dx) + Math.abs(rect.top + rect.height / 2 - fromY) * 1.6;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  });

  best?.focus();
}

addEventListener('keydown', (event) => {
  if (isTyping(event.target)) {
    if (event.key === 'Escape') event.target.blur();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  switch (event.key) {
    case 'Escape':
      // Unwind topmost first: a zoom sits over the shelf, which sits over layers.
      if (isPeeking()) hidePeek();
      else if (isComparing()) closeCompare();
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
    case 'ArrowRight':
    case 'ArrowLeft':
      event.preventDefault();
      moveSelection(event.key === 'ArrowRight' ? 'right' : 'left');
      break;
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
