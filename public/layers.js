import { getPin, getRelated } from './api.js';
import { createCard } from './cards.js';
import { createMasonry } from './masonry.js';
import { shelf } from './shelf.js';

// Each entry is one level of the dig. Entries stay mounted when deeper layers
// open on top, so popping back is instant and keeps its scroll position.
const stack = [];

let root;
let rail;
let backdrop;
let onChange = () => {};

// How many layers stay visible behind the top one before they fade out.
const VISIBLE_DEPTH = 4;

export function initLayers(options) {
  root = options.root;
  rail = options.rail;
  backdrop = options.backdrop;
  onChange = options.onChange || onChange;

  // Clicking the dimmed area steps back one level, like a soft "back".
  backdrop.addEventListener('click', () => pop());
  shelf.subscribe(syncShelfButtons);
}

export const depth = () => stack.length;
export const isOpen = () => stack.length > 0;
export const chain = () => stack.map((layer) => layer.pin.id);
/** The only interactive layer — where arrow-key selection should apply. */
export const topElement = () => stack.at(-1)?.el || null;

/** Open a pin as a new layer on top of whatever is already there. */
export async function open(pinOrId) {
  const summary = typeof pinOrId === 'string' ? null : pinOrId;
  const id = summary ? summary.id : String(pinOrId);
  if (stack.at(-1)?.pin.id === id) return;

  // Render from the summary we already have so the image appears instantly;
  // detail and related pins fill in when they land.
  const layer = {
    pin: summary || { id, title: '', color: '#2a2a2e' },
    bookmark: null,
    loading: false,
    done: false,
  };
  build(layer);
  stack.push(layer);
  restyle();
  onChange();

  try {
    const data = await getPin(id);
    if (!stack.includes(layer)) return; // popped while loading
    layer.pin = data.pin;
    layer.bookmark = data.bookmark;
    layer.done = !data.bookmark;
    hydrate(layer);
    addRelated(layer, data.related);
    layer.more.hidden = true;
    layer.spinner.hidden = true;
    if (!data.related.length) {
      layer.status.hidden = false;
      layer.status.textContent = 'No related pins for this one.';
    }
    watchScroll(layer);
  } catch (err) {
    if (!stack.includes(layer)) return;
    layer.spinner.hidden = true;
    layer.status.hidden = false;
    layer.status.textContent = err.message;
  }
}

/** Drop every layer above `target` depth. */
export function popTo(target) {
  const keep = Math.max(0, target);
  while (stack.length > keep) {
    const layer = stack.pop();
    layer.observer?.disconnect();
    layer.el.classList.add('leaving');
    layer.el.addEventListener('transitionend', () => layer.el.remove(), { once: true });
    setTimeout(() => layer.el.remove(), 400);
  }
  restyle();
  onChange();
}

export const pop = () => popTo(stack.length - 1);
export const closeAll = () => popTo(0);

/**
 * Force the stack to match a chain of pin ids (used when restoring history).
 * Reuses the existing layers where the chains agree so going back is seamless.
 */
export async function setChain(ids) {
  let shared = 0;
  while (shared < ids.length && shared < stack.length && stack[shared].pin.id === ids[shared]) {
    shared += 1;
  }
  popTo(shared);
  for (const id of ids.slice(shared)) await open(id);
}

/** Apply the depth transform: the top layer is live, the rest recede behind it. */
function restyle() {
  stack.forEach((layer, index) => {
    const d = stack.length - 1 - index;
    layer.el.style.zIndex = String(index + 1);
    layer.el.style.setProperty('--d', String(d));
    layer.el.classList.toggle('behind', d > 0);
    layer.el.classList.toggle('hidden-deep', d > VISIBLE_DEPTH);
    layer.el.inert = d > 0;
  });
  document.body.classList.toggle('layered', stack.length > 0);
  backdrop.hidden = stack.length === 0;
  renderRail();
}

/** The rail is the trail: every level you opened, in order, clickable. */
function renderRail() {
  rail.replaceChildren();
  rail.hidden = stack.length === 0;
  if (!stack.length) return;

  const home = document.createElement('button');
  home.type = 'button';
  home.className = 'rail-chip rail-home';
  home.title = 'Back to results (Esc)';
  home.textContent = '⌂';
  home.addEventListener('click', () => {
    closeAll();
  });
  rail.append(home);

  stack.forEach((layer, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'rail-chip';
    chip.classList.toggle('current', index === stack.length - 1);
    chip.title = layer.pin.title || `Layer ${index + 1}`;
    if (layer.pin.thumb) {
      const img = document.createElement('img');
      img.src = layer.pin.thumb;
      img.alt = '';
      chip.append(img);
    }
    chip.style.backgroundColor = layer.pin.color;
    chip.addEventListener('click', () => popTo(index + 1));
    rail.append(chip);
  });
}

function build(layer) {
  const el = document.createElement('section');
  el.className = 'layer entering';

  el.innerHTML = `
    <header class="layer-head">
      <div class="layer-title">
        <h2></h2>
        <p class="layer-meta"></p>
      </div>
      <div class="layer-actions">
        <button type="button" class="layer-save">Shelf</button>
        <a class="layer-source" target="_blank" rel="noopener noreferrer" hidden>Source ↗</a>
        <button type="button" class="layer-close" aria-label="Close layer">✕</button>
      </div>
    </header>
    <div class="layer-body">
      <div class="layer-hero"><img alt="" /></div>
      <div class="layer-related">
        <h3>More like this</h3>
        <div class="sub-grid"></div>
        <div class="layer-sentinel"></div>
        <div class="spinner" hidden></div>
        <p class="status" hidden>Loading…</p>
        <button type="button" class="more" hidden>Load more</button>
      </div>
    </div>`;

  layer.el = el;
  layer.grid = el.querySelector('.sub-grid');
  layer.more = el.querySelector('.more');
  layer.status = el.querySelector('.status');
  layer.hero = el.querySelector('.layer-hero img');
  layer.sentinel = el.querySelector('.layer-sentinel');
  layer.spinner = el.querySelector('.spinner');
  layer.spinner.hidden = false;
  layer.status.hidden = true;

  el.querySelector('.layer-close').addEventListener('click', () => {
    const index = stack.indexOf(layer);
    if (index >= 0) popTo(index);
  });
  el.querySelector('.layer-save').addEventListener('click', () => shelf.toggle(layer.pin));
  layer.more.addEventListener('click', () => loadMore(layer));

  hydrate(layer);
  root.append(el);
  // Masonry needs the element measurable, so build it once it's in the document.
  layer.masonry = createMasonry(layer.grid, { gap: 14, minColumn: 200 });
  // Let the entering transform paint before settling into place.
  requestAnimationFrame(() => el.classList.remove('entering'));
}

function addRelated(layer, pins) {
  layer.masonry.append(pins, (pin) => createCard(pin, { onOpen: open, size: 'sub' }));
}

/**
 * Keep the related feed loading itself. Using the layer as the observer root
 * works whichever descendant actually scrolls (it changes with the breakpoint).
 */
function watchScroll(layer) {
  if (layer.observer) return;
  layer.observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore(layer);
    },
    { root: layer.el, rootMargin: '900px' },
  );
  layer.observer.observe(layer.sentinel);
}

function hydrate(layer) {
  const { pin } = layer;
  layer.el.querySelector('h2').textContent = pin.title || 'Untitled pin';

  const meta = [pin.domain, pin.pinner?.name, pin.board?.name].filter(Boolean);
  layer.el.querySelector('.layer-meta').textContent = meta.join(' · ');

  if (pin.large || pin.thumb) {
    layer.hero.src = pin.large || pin.thumb;
    layer.hero.alt = pin.alt || pin.title || 'Pin image';
    layer.hero.style.backgroundColor = pin.color;
    if (pin.width && pin.height) layer.hero.style.aspectRatio = `${pin.width} / ${pin.height}`;
  }

  const source = layer.el.querySelector('.layer-source');
  source.hidden = !pin.link;
  if (pin.link) source.href = pin.link;

  syncShelfButtons();
}

function syncShelfButtons() {
  for (const layer of stack) {
    const button = layer.el.querySelector('.layer-save');
    const saved = shelf.has(layer.pin.id);
    button.classList.toggle('on', saved);
    button.textContent = saved ? 'Shelved ✓' : 'Shelf';
  }
}

async function loadMore(layer) {
  if (layer.loading || layer.done) return;
  layer.loading = true;
  layer.more.hidden = true;
  layer.status.hidden = true;
  layer.spinner.hidden = false;

  try {
    const data = await getRelated(layer.pin.id, layer.bookmark);
    if (!stack.includes(layer)) return;
    addRelated(layer, data.pins);
    layer.bookmark = data.bookmark;
    layer.done = !data.bookmark;
    // Only a fallback now that the feed loads itself.
    layer.more.hidden = true;
    if (layer.done) {
      layer.observer?.disconnect();
      layer.status.hidden = false;
      layer.status.textContent = 'End of related pins.';
    }
  } catch (err) {
    if (!stack.includes(layer)) return;
    layer.status.hidden = false;
    layer.status.textContent = err.message;
    layer.more.hidden = false;
  } finally {
    layer.loading = false;
    if (stack.includes(layer)) {
      layer.spinner.hidden = true;
      rearm(layer);
    }
  }
}

/** Same re-arm trick as the main grid: force a fresh intersection report. */
function rearm(layer) {
  if (layer.done || !layer.observer) return;
  layer.observer.unobserve(layer.sentinel);
  requestAnimationFrame(() => layer.observer?.observe(layer.sentinel));
}
