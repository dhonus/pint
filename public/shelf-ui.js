import { shelf } from './shelf.js';
import { setActivePin } from './active.js';
import { zoom } from './peek.js';
import { openStashMenu } from './shelf-picker.js';
import { initTileSize } from './tile-size.js';

// The shelf bar lives at the bottom; "Compare" blows it up into a full grid so
// you can see six jackets next to each other — the thing Pinterest can't do.
let bar;
let strip;
let countEl;
let compareEl;
let compareGrid;
let onOpen = () => {};
let compareOpen = false;

export const isComparing = () => compareOpen;

export function initShelf(options) {
  bar = options.bar;
  onOpen = options.onOpen || onOpen;

  strip = bar.querySelector('.shelf-strip');
  countEl = bar.querySelector('.shelf-count');
  compareEl = options.compare;
  compareGrid = compareEl.querySelector('.compare-grid');

  bar.querySelector('.shelf-compare').addEventListener('click', toggleCompare);
  bar.querySelector('.shelf-clear').addEventListener('click', () => {
    if (confirm('Empty the stash?')) shelf.clear();
  });

  // Promote the whole scratch pile into a shelf — a new one or an existing one.
  const push = bar.querySelector('.shelf-push');
  push.addEventListener('click', () => {
    if (!shelf.count()) return;
    closeCompare();
    openStashMenu(shelf.list(), { anchor: push });
  });
  compareEl.querySelector('.compare-close').addEventListener('click', closeCompare);
  initTileSize(compareEl.querySelector('.size-slider'));
  // Clicking the dimmed area behind the panel closes it, like any modal.
  compareEl.addEventListener('pointerdown', (event) => {
    if (event.target === compareEl) closeCompare();
  });

  shelf.subscribe(render);
  render();
}

function thumb(pin, { big = false } = {}) {
  const wrap = document.createElement('figure');
  wrap.className = big ? 'compare-item' : 'shelf-item';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shelf-open';
  // In the overview, clicking is for looking closer; digging gets its own button.
  button.title = big ? 'Zoom' : pin.title || 'Open';
  const img = document.createElement('img');
  img.src = big ? pin.large || pin.thumb : pin.thumb;
  img.alt = pin.title || '';
  img.loading = 'lazy';
  img.style.backgroundColor = pin.color;
  if (big && pin.width && pin.height) img.style.aspectRatio = `${pin.width} / ${pin.height}`;
  button.append(img);
  button.addEventListener('click', () => {
    if (big) {
      zoom(pin, { set: shelf.list() });
      return;
    }
    closeCompare();
    onOpen(pin);
  });
  // So Space-to-peek and arrow-key selection work over the shelf too.
  const activate = () => setActivePin(pin);
  wrap.addEventListener('pointerenter', activate);
  wrap.addEventListener('focusin', activate);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'shelf-remove';
  remove.title = 'Remove from shelf';
  remove.textContent = '✕';
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    shelf.remove(pin.id);
  });

  wrap.append(button, remove);

  if (big) {
    const dig = document.createElement('button');
    dig.type = 'button';
    dig.className = 'shelf-dig';
    dig.textContent = 'Open';
    dig.title = 'Open as a layer';
    dig.addEventListener('click', (event) => {
      event.stopPropagation();
      closeCompare();
      onOpen(pin);
    });
    wrap.append(dig);
  }

  if (big && pin.title) {
    const caption = document.createElement('figcaption');
    caption.textContent = pin.title;
    wrap.append(caption);
  }
  return wrap;
}

function render() {
  const items = shelf.list();
  countEl.textContent = String(items.length);
  bar.classList.toggle('empty', items.length === 0);

  strip.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const pin of items) frag.append(thumb(pin));
  strip.append(frag);

  if (compareOpen) renderCompare();
  if (!items.length) closeCompare();
}

function renderCompare() {
  compareGrid.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const pin of shelf.list()) frag.append(thumb(pin, { big: true }));
  compareGrid.append(frag);
}

function toggleCompare() {
  if (compareOpen) closeCompare();
  else if (shelf.count()) {
    compareOpen = true;
    compareEl.hidden = false;
    document.body.classList.add('comparing');
    renderCompare();
  }
}

export function closeCompare() {
  if (!compareOpen) return;
  compareOpen = false;
  compareEl.hidden = true;
  document.body.classList.remove('comparing');
}
