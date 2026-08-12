import { getPin, getRelated, isAbort } from './api.js';
import { createCard } from './cards.js';
import { createMasonry } from './masonry.js';
import { shelf } from './shelf.js';
import { shelvesFor, onShelvesChange } from './shelves.js';

// Each entry is one level of the dig. Entries stay mounted when deeper layers
// open on top, so popping back is instant and keeps its scroll position.
const stack = [];

let root;
let rail;
let backdrop;
let onChange = () => {};

// How many layers stay visible behind the top one before they fade out.
const VISIBLE_DEPTH = 4;

// How long the arrow keys must settle before a layer fetches its detail feed.
const STEP_DEBOUNCE_MS = 250;

// The rail swaps sides at the middle of the window. The dead band is just wide
// enough that a hand resting on the midpoint can't make it flicker.
const RAIL_DEAD_ZONE_PX = 24;
// Matches the CSS exit transition, so the jump happens while it's invisible.
const RAIL_FADE_MS = 120;
let railSide = 'left';
let railTimer = null;

export function initLayers(options) {
  root = options.root;
  rail = options.rail;
  backdrop = options.backdrop;
  onChange = options.onChange || onChange;

  // Clicking the dimmed area steps back one level, like a soft "back".
  backdrop.addEventListener('click', () => pop());
  shelf.subscribe(syncShelfButtons);
  onShelvesChange(syncShelfButtons);

  // The trail follows the cursor's side of the screen, so stepping back a
  // couple of layers never means crossing the whole window to reach it.
  addEventListener(
    'pointermove',
    (event) => {
      if (!stack.length) return;
      const middle = innerWidth / 2;
      if (event.clientX > middle + RAIL_DEAD_ZONE_PX) setRailSide('right');
      else if (event.clientX < middle - RAIL_DEAD_ZONE_PX) setRailSide('left');
    },
    { passive: true },
  );
}

export const depth = () => stack.length;
export const isOpen = () => stack.length > 0;
export const chain = () => stack.map((layer) => layer.pin.id);
/** The only interactive layer — where arrow-key selection should apply. */
export const topElement = () => stack.at(-1)?.el || null;

/**
 * Open a pin as a new layer on top of whatever is already there.
 * @param {object|string} pinOrId
 * @param {{siblings: object[], index: number}} [context] the feed it came from,
 *   so the arrow keys can walk the hero along to its neighbours.
 */
export async function open(pinOrId, context) {
  const summary = typeof pinOrId === 'string' ? null : pinOrId;
  const id = summary ? summary.id : String(pinOrId);
  if (stack.at(-1)?.pin.id === id) return;

  // Render from the summary we already have so the image appears instantly;
  // detail and related pins fill in when they land.
  const layer = {
    pin: summary || { id, title: '', color: '#2a2a2e' },
    siblings: context?.siblings || [],
    index: context?.index ?? -1,
    bookmark: null,
    loading: false,
    done: false,
    relatedPins: [],
  };
  build(layer);
  stack.push(layer);
  restyle();
  onChange();
  await fill(layer);
}

/** Swap the hero for its neighbour in the feed this layer came from. */
export function step(delta) {
  const layer = stack.at(-1);
  if (!layer || layer.index < 0) return;

  const next = layer.index + delta;
  const pin = layer.siblings[next];
  if (!pin) return;

  layer.index = next;
  layer.pin = pin;
  layer.bookmark = null;
  layer.done = false;
  layer.loading = false;
  layer.relatedPins = [];
  layer.masonry.clear();
  layer.related.scrollTop = 0;
  layer.body.scrollTop = 0;
  // The image swaps now, from the summary we already have in hand.
  hydrate(layer);
  restyle();
  // Stepping is browsing, not a new destination, so don't stack history entries.
  onChange({ replace: true });
  scheduleFill(layer);
}

/**
 * Hold off on the network until the arrow keys settle. Blowing through ten
 * images shouldn't mean ten round trips to Pinterest — the hero is already
 * showing, and only the detail and related feed need fetching.
 */
function scheduleFill(layer) {
  clearTimeout(layer.fillTimer);
  cancelFill(layer);
  layer.spinner.hidden = false;
  layer.status.hidden = true;
  layer.fillTimer = setTimeout(() => fill(layer), STEP_DEBOUNCE_MS);
}

/** Drop any in-flight request whose result we no longer want. */
function cancelFill(layer) {
  layer.controller?.abort();
  layer.controller = null;
}

/** Load detail and the first page of related pins into an existing layer. */
async function fill(layer) {
  layer.spinner.hidden = false;
  layer.status.hidden = true;

  const controller = new AbortController();
  layer.controller = controller;
  const requested = layer.pin.id;

  try {
    const data = await getPin(requested, controller.signal);
    // Bail if the layer went away or stepped on while this was in flight.
    if (!stack.includes(layer) || layer.pin.id !== requested) return;
    // Keep the position we already know; detail has no sibling context.
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
    // A superseded request isn't a failure worth showing.
    if (isAbort(err) || !stack.includes(layer) || layer.pin.id !== requested) return;
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
    clearTimeout(layer.fillTimer);
    cancelFill(layer);
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

/**
 * Leave towards the side you're heading for, then arrive from the far edge of
 * the new one — so the move reads as travel rather than a teleport, without
 * dragging a pill across the images you're looking at.
 */
function setRailSide(side) {
  if (side === railSide) return;
  railSide = side;
  clearTimeout(railTimer);

  rail.classList.remove('enter-left', 'enter-right');
  rail.classList.add(`exit-${side}`);

  railTimer = setTimeout(() => {
    rail.classList.remove(`exit-${side}`);
    rail.classList.toggle('on-right', side === 'right');
    rail.classList.add(`enter-${side}`);
    // Two frames: one to apply the offset, one to animate away from it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => rail.classList.remove(`enter-${side}`)),
    );
  }, RAIL_FADE_MS);
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
        <span class="layer-in" hidden></span>
        <button type="button" class="layer-save">Stash</button>
        <button type="button" class="layer-file" title="File into a shelf">Shelf ▾</button>
        <a class="layer-source" target="_blank" rel="noopener noreferrer" hidden>Source ↗</a>
        <button type="button" class="layer-close" aria-label="Close layer">✕</button>
      </div>
    </header>
    <div class="layer-body">
      <div class="layer-hero"><img alt="" /></div>
      <div class="layer-related">
        <h3>More like this</h3>
        <div class="sub-grid"></div>
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
  layer.body = el.querySelector('.layer-body');
  layer.related = el.querySelector('.layer-related');
  layer.spinner = el.querySelector('.spinner');
  layer.spinner.hidden = false;
  layer.status.hidden = true;

  el.querySelector('.layer-close').addEventListener('click', () => {
    const index = stack.indexOf(layer);
    if (index >= 0) popTo(index);
  });
  el.querySelector('.layer-save').addEventListener('click', () => shelf.toggle(layer.pin));

  // Same menu the grid gets, anchored to the button that opened it.
  const file = el.querySelector('.layer-file');
  const openMenu = (event) => {
    event.preventDefault();
    el.dispatchEvent(
      new CustomEvent('pin:menu', {
        bubbles: true,
        detail: { pin: layer.pin, anchor: file, x: event.clientX, y: event.clientY },
      }),
    );
  };
  file.addEventListener('click', openMenu);
  el.querySelector('.layer-hero').addEventListener('contextmenu', openMenu);
  layer.more.addEventListener('click', () => loadMore(layer));

  hydrate(layer);
  root.append(el);
  // Masonry needs the element measurable, so build it once it's in the document.
  layer.masonry = createMasonry(layer.grid, { gap: 14, minColumn: 200 });
  // Let the entering transform paint before settling into place.
  requestAnimationFrame(() => el.classList.remove('entering'));
}

function addRelated(layer, pins) {
  const start = layer.relatedPins.length;
  layer.relatedPins.push(...pins);
  layer.masonry.append(pins, (pin, offset) =>
    createCard(pin, {
      // Digging from here carries this feed along as the new layer's siblings.
      onOpen: (target) =>
        open(target, { siblings: layer.relatedPins, index: start + offset }),
      size: 'sub',
    }),
  );
}

/**
 * Keep the related feed loading itself.
 *
 * Which element actually scrolls changes with the breakpoint (the feed pane on
 * desktop, the whole body on narrow screens), so listen to both and measure the
 * distance to the bottom directly. That sidesteps the clipping rules an
 * IntersectionObserver would be subject to inside a nested scroller.
 */
function watchScroll(layer) {
  if (layer.watching) return;
  layer.watching = true;

  layer.checkScroll = () => {
    if (layer.loading || layer.done) return;
    for (const el of [layer.related, layer.body]) {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (el.scrollHeight > el.clientHeight && remaining < 900) {
        loadMore(layer);
        return;
      }
    }
  };

  layer.related.addEventListener('scroll', layer.checkScroll, { passive: true });
  layer.body.addEventListener('scroll', layer.checkScroll, { passive: true });
  // The first page may not even fill the pane.
  layer.checkScroll();
}

function hydrate(layer) {
  const { pin } = layer;
  layer.el.querySelector('h2').textContent = pin.title || 'Untitled pin';

  const meta = [pin.domain, pin.pinner?.name, pin.board?.name].filter(Boolean);
  layer.el.querySelector('.layer-meta').textContent = meta.join(' · ');

  if (pin.large || pin.thumb) {
    layer.hero.src = pin.large || pin.thumb;
    layer.hero.alt = pin.alt || pin.title || 'Pin image';
  }

  const source = layer.el.querySelector('.layer-source');
  source.hidden = !pin.link;
  if (pin.link) source.href = pin.link;

  syncShelfButtons();
}

function syncShelfButtons() {
  for (const layer of stack) {
    const button = layer.el.querySelector('.layer-save');
    const stashed = shelf.has(layer.pin.id);
    button.classList.toggle('on', stashed);
    button.textContent = stashed ? 'Stashed ✓' : 'Stash';

    // Say which shelves already hold this pin, rather than making you check.
    const names = shelvesFor(layer.pin.id);
    const label = layer.el.querySelector('.layer-in');
    label.hidden = names.length === 0;
    label.textContent = names.length ? `In ${names.join(', ')}` : '';
  }
}

async function loadMore(layer) {
  if (layer.loading || layer.done) return;
  layer.loading = true;
  layer.more.hidden = true;
  layer.status.hidden = true;
  layer.spinner.hidden = false;

  const requested = layer.pin.id;
  try {
    const data = await getRelated(requested, layer.bookmark);
    // A step while this was in flight means these pins belong to another pin.
    if (!stack.includes(layer) || layer.pin.id !== requested) return;
    addRelated(layer, data.pins);
    layer.bookmark = data.bookmark;
    layer.done = !data.bookmark;
    // Only a fallback now that the feed loads itself.
    layer.more.hidden = true;
    if (layer.done) {
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
    // Don't clear a spinner that now belongs to a pending step.
    if (stack.includes(layer) && layer.pin.id === requested) {
      layer.spinner.hidden = true;
      // If the new page still didn't reach past the fold, keep going.
      requestAnimationFrame(() => layer.checkScroll?.());
    }
  }
}
