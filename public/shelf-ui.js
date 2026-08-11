import { shelf } from './shelf.js';

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
    if (confirm('Remove everything from the shelf?')) shelf.clear();
  });
  compareEl.querySelector('.compare-close').addEventListener('click', closeCompare);

  shelf.subscribe(render);
  render();
}

function thumb(pin, { big = false } = {}) {
  const wrap = document.createElement('figure');
  wrap.className = big ? 'compare-item' : 'shelf-item';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shelf-open';
  button.title = pin.title || 'Open';
  const img = document.createElement('img');
  img.src = pin.thumb;
  img.alt = pin.title || '';
  img.loading = 'lazy';
  img.style.backgroundColor = pin.color;
  if (big && pin.width && pin.height) img.style.aspectRatio = `${pin.width} / ${pin.height}`;
  button.append(img);
  button.addEventListener('click', () => {
    closeCompare();
    onOpen(pin);
  });

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
