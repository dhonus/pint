import { searchPins } from './api.js';
import { createCard } from './cards.js';
import { getActivePin, getActiveCard } from './active.js';
import {
  initShelves,
  open as openShelves,
  back as shelvesBack,
  close as closeShelves,
  isShelvesOpen,
  onShelvesChange,
  viewState as shelvesView,
  applyView as applyShelvesView,
} from './shelves.js';
import { initSuggest, hide as hideSuggest } from './suggest.js';
import { initAllHScroll } from './hscroll.js';
import { openPicker, close as closePicker, isPickerOpen, pickerKey } from './shelf-picker.js';
import { toast } from './toast.js';
import { createMasonry } from './masonry.js';
import { shelf } from './shelf.js';
import * as layers from './layers.js';
import { initShelf, isComparing, closeCompare } from './shelf-ui.js';
import { initHome, showHome, remember, recentSearches } from './home.js';
import {
  initPeek,
  isPeeking,
  isZooming,
  currentPin,
  zoomSet,
  zoom,
  hide as hidePeek,
} from './peek.js';

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');
const moreBtn = document.getElementById('more');
const sentinel = document.getElementById('sentinel');
const spinner = document.getElementById('loading');
const guidesEl = document.getElementById('guides');

// `pins` is kept so a layer opened from the grid can walk left/right along it.
const state = { query: '', bookmark: null, loading: false, done: false, pins: [] };
// Two columns on a phone, wider ones as the screen allows.
const masonry = createMasonry(grid, {
  gap: 16,
  minColumn: () => (innerWidth < 640 ? 150 : 240),
});
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
    state.pins = [];
    state.bookmark = null;
    state.done = false;
  }
  setStatus('');
  spinner.hidden = false;

  try {
    const data = await searchPins(state.query, state.bookmark);
    // A newer search may have started while this was in flight.
    if (data.query !== state.query) return;

    if (reset) renderGuides(data.guides);
    const start = state.pins.length;
    state.pins.push(...data.pins);
    masonry.append(data.pins, (pin, offset) =>
      createCard(pin, {
        onOpen: (target) =>
          layers.open(target, { siblings: state.pins, index: start + offset }),
      }),
    );
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
    state.pins = [];
    renderGuides([]);
    moreBtn.hidden = true;
    spinner.hidden = true;
    state.bookmark = null;
    state.done = false;
    setStatus('');
    showHome(true);
    return Promise.resolve();
  }

  showHome(false);
  remember(query);
  return loadResults({ reset: true });
}

/** Pinterest's refinement terms for the current search, as chips. */
function renderGuides(guides) {
  guidesEl.replaceChildren();
  guidesEl.hidden = !guides?.length;
  if (!guides?.length) return;

  for (const guide of guides) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'guide';
    if (guide.image) {
      const img = document.createElement('img');
      img.src = guide.image;
      img.alt = '';
      img.loading = 'lazy';
      chip.append(img);
    }
    const label = document.createElement('span');
    label.textContent = guide.label;
    chip.append(label);
    chip.title = guide.term;
    chip.addEventListener('click', () => {
      input.value = guide.term;
      form.requestSubmit();
    });
    guidesEl.append(chip);
  }
}

/* ---------- layers ---------- */

/** Opening from the shelf walks the shelf; from anywhere else, just the pin. */
function openLayer(pin) {
  // Layers sit below the shelves modal, so digging from there has to leave it
  // first or the new layer opens out of sight underneath.
  closeShelves();
  closeCompare();
  const items = shelf.list();
  const index = items.findIndex((item) => item.id === pin.id);
  layers.open(pin, index >= 0 ? { siblings: items, index } : undefined);
}

layers.initLayers({
  root: document.getElementById('layers'),
  rail: document.getElementById('rail'),
  backdrop: document.getElementById('backdrop'),
  onChange: (options) => {
    if (restoring) return;
    if (options?.replace) history.replaceState(snapshot(), '', currentUrl());
    else pushState();
  },
});

/* ---------- history ---------- */

function currentUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  const trail = layers.chain();
  if (trail.length) params.set('pin', trail.join(','));
  // The shelves overlay is a place you can be, so Back can leave it.
  const view = shelvesView();
  if (view) params.set('shelves', view.mode === 'shelf' ? view.id : view.mode);
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}

function snapshot() {
  return { q: state.query, chain: layers.chain(), shelves: shelvesView() };
}

function pushState() {
  history.pushState(snapshot(), '', currentUrl());
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  const shelves = params.get('shelves');
  return {
    q: (params.get('q') || '').trim(),
    chain: (params.get('pin') || '').split(',').filter(Boolean),
    shelves: !shelves
      ? null
      : shelves === 'index' || shelves === 'everything'
        ? { mode: shelves }
        : { mode: 'shelf', id: shelves },
  };
}

/** Replay a history entry: query, then the layer trail, then the overlay. */
async function restore(target) {
  restoring = true;
  try {
    if (target.q !== state.query) await runSearch(target.q);
    await layers.setChain(target.chain || []);
    await applyShelvesView(target.shelves || null);
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
initPeek({ onOpen: openLayer });
initShelves({
  root: document.getElementById('shelves'),
  onOpen: openLayer,
  onNavigate: () => {
    if (!restoring) pushState();
  },
});

initSuggest({ input, form, source: recentSearches });
initAllHScroll();

const shelvesBtn = document.getElementById('open-shelves');
const shelvesCount = document.getElementById('shelves-count');
shelvesBtn.addEventListener('click', openShelves);
onShelvesChange((summaries) => {
  shelvesCount.textContent = String(summaries.length);
  shelvesBtn.classList.toggle('has-shelves', summaries.length > 0);
});

initHome({
  home: document.getElementById('home'),
  onPick: (query) => {
    input.value = query;
    form.requestSubmit();
  },
});

/* ---------- input wiring ---------- */

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query || query === state.query) return;
  // Hand the keyboard back so `s`, arrows and space work on the results.
  hideSuggest();
  input.blur();
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

/** Walk a zoomed image along whichever set it was opened from. */
function stepZoom(delta) {
  const items = zoomSet().length ? zoomSet() : shelf.list();
  const index = items.findIndex((item) => item.id === currentPin()?.id);
  const next = items[index + delta];
  if (next) zoom(next, { set: items });
}

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

/* ---------- stash: tap to add, hold to file ---------- */

const HOLD_MS = 320;

/**
 * What `s` acts on. With a layer open that's the big image, unless the pointer
 * is over one of the related cards inside it.
 */
function stashTarget() {
  const top = layers.topElement();
  if (!top) return getActivePin();
  const card = getActiveCard();
  if (card && top.contains(card)) return getActivePin();
  return layers.currentPin() || getActivePin();
}
let holdTimer = null;
let holdCard = null;
let holdFired = false;

function startHold(pin) {
  holdFired = false;
  const top = layers.topElement();
  const hovered = getActiveCard();
  // Only treat it as a card hold when that card belongs to the layer on top.
  holdCard = !top || (hovered && top.contains(hovered)) ? hovered : null;
  // The ring filling on the card is the affordance — it tells you a hold is
  // a thing before you've held long enough to find out.
  holdCard?.classList.add('holding');
  const card = holdCard;
  holdTimer = setTimeout(() => {
    holdFired = true;
    endHold();
    openPicker(pin, {
      // Falls back to the layer's own shelf button, then to screen centre.
      anchor: card?.querySelector('.card-shelf') || top?.querySelector('.layer-file'),
      x: innerWidth / 2,
      y: innerHeight / 2,
    });
  }, HOLD_MS);
}

function endHold() {
  clearTimeout(holdTimer);
  holdTimer = null;
  holdCard?.classList.remove('holding');
  holdCard = null;
}

// Right-click anywhere a card lives opens the same menu.
addEventListener('pin:menu', (event) => {
  const { pin, anchor, x, y } = event.detail;
  openPicker(pin, { anchor, x, y });
});

addEventListener('keyup', (event) => {
  if (event.key !== 's' && event.key !== 'S') return;
  const wasHolding = holdTimer !== null;
  endHold();
  // A quick tap is the common case: stash it and get out of the way.
  if (wasHolding && !holdFired) {
    const pin = stashTarget();
    if (pin) {
      const added = shelf.toggle(pin);
      toast(added ? 'Stashed' : 'Removed from stash');
    }
  }
});

addEventListener('keydown', (event) => {
  if (isTyping(event.target)) {
    if (event.key === 'Escape') event.target.blur();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // The picker owns the keyboard while it's up.
  if (pickerKey(event)) {
    event.preventDefault();
    return;
  }

  switch (event.key) {
    case 'Escape':
      // Unwind topmost first: a zoom sits over the shelf, which sits over layers.
      if (isPeeking()) hidePeek();
      else if (isShelvesOpen()) shelvesBack();
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
      if (event.repeat || holdTimer) break;
      const pin = stashTarget();
      if (pin) startHold(pin);
      break;
    }
    case 'ArrowRight':
    case 'ArrowLeft': {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      // Arrows drive whatever big image is on screen; only fall back to moving
      // the selection when there isn't one.
      if (isZooming()) stepZoom(delta);
      else if (layers.isOpen()) layers.step(delta);
      else moveSelection(delta > 0 ? 'right' : 'left');
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
// `restore` skips runSearch when the query already matches, which on a cold
// start with no query means nothing would ever show the empty state.
showHome(!initial.q);
// Focus the box only when there's nothing to browse yet — landing on results
// with the caret in the search bar means `s` types instead of stashing.
if (!initial.q) input.focus();
history.replaceState({ q: initial.q, chain: initial.chain }, '', currentUrl());
restore(initial).then(() => history.replaceState(snapshot(), '', currentUrl()));
