import { setActivePin } from './active.js';
import { zoom } from './peek.js';
import { attachMenuGesture } from './menu-gesture.js';

// Saved collections, kept on the server. The stash at the bottom of the screen
// is the scratch space you fill while digging; a shelf is what you keep.
const listeners = new Set();
let summaries = [];
// pinId -> shelf names holding it, so the grid can mark what's already saved.
let membership = {};
let onOpen = () => {};

let root;
let body;
let titleEl;
let backBtn;
let everythingBtn;
let mode = 'index';
let current = null;
let onNavigate = () => {};
// True while replaying history, so restoring doesn't push more entries.
let restoringView = false;

export const isShelvesOpen = () => root && !root.hidden;
export const shelfCount = () => summaries.length;
export const onShelvesChange = (fn) => listeners.add(fn);

async function api(method, path, payload) {
  const res = await fetch(`/api/shelves${path}`, {
    method,
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function refresh() {
  const data = await api('GET', '?index=1');
  summaries = data.shelves;
  membership = data.pins || {};
  for (const fn of listeners) fn(summaries);
  return summaries;
}

/** Which shelves hold this pin. Empty array when it isn't saved anywhere. */
export const shelvesFor = (pinId) => membership[pinId] || [];

/** Cached summaries, so the picker can render instantly. */
export const listSummaries = () => summaries;

/** Turn the current stash into a saved shelf. */
export async function saveAsShelf(name, pins) {
  const data = await api('POST', '', { name, pins });
  await refresh();
  return data.shelf;
}

/** File pins into an existing shelf; duplicates are dropped server side. */
export async function addToShelf(id, pins) {
  const data = await api('PATCH', `/${id}`, { addPins: pins });
  await refresh();
  return data.shelf;
}

export async function removeFromShelf(id, pinId) {
  const data = await api('DELETE', `/${id}/pins/${pinId}`);
  await refresh();
  return data.shelf;
}

/* ---------- rendering ---------- */

function tile(pin, shelfId, siblings) {
  const wrap = document.createElement('figure');
  wrap.className = 'shelf-tile';

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'shelf-open';
  open.title = pin.title || 'Zoom';
  const img = document.createElement('img');
  img.src = pin.thumb;
  img.alt = pin.title || '';
  img.loading = 'lazy';
  img.style.backgroundColor = pin.color;
  if (pin.width && pin.height) img.style.aspectRatio = `${pin.width} / ${pin.height}`;
  open.append(img);
  const activate = () => setActivePin(pin);
  const gesture = attachMenuGesture(wrap, () => pin, { activate });

  open.addEventListener('click', () => {
    if (gesture.consumed()) return;
    // Zoom walks this shelf, so left/right move through what you're looking at.
    zoom(pin, { set: siblings });
  });

  wrap.addEventListener('pointerenter', activate);
  wrap.addEventListener('focusin', activate);

  const dig = document.createElement('button');
  dig.type = 'button';
  dig.className = 'shelf-dig';
  dig.textContent = 'Open';
  dig.addEventListener('click', (event) => {
    event.stopPropagation();
    close();
    onOpen(pin);
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'shelf-remove';
  remove.title = 'Remove from shelf';
  remove.textContent = '✕';
  remove.addEventListener('click', async (event) => {
    event.stopPropagation();
    await api('DELETE', `/${shelfId}/pins/${pin.id}`);
    await refresh();
    if (mode === 'shelf') showShelf(shelfId);
    else showEverything();
  });

  wrap.append(open, remove, dig);
  return wrap;
}

function grid(pins, shelfId) {
  const el = document.createElement('div');
  el.className = 'shelves-grid';
  for (const pin of pins) el.append(tile(pin, shelfId, pins));
  return el;
}

function shelfCard(summary) {
  const card = document.createElement('article');
  card.className = 'shelf-card';

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'shelf-card-open';
  open.addEventListener('click', () => showShelf(summary.id));

  // Up to four thumbs as a 2x2 cover.
  const cover = document.createElement('div');
  cover.className = 'shelf-cover';
  cover.dataset.count = String(Math.min(summary.cover.length, 4));
  for (const src of summary.cover.slice(0, 4)) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    cover.append(img);
  }
  if (!summary.cover.length) cover.classList.add('empty');

  const meta = document.createElement('div');
  meta.className = 'shelf-meta';
  const name = document.createElement('strong');
  name.textContent = summary.name;
  const count = document.createElement('span');
  count.textContent = `${summary.count} ${summary.count === 1 ? 'pin' : 'pins'}`;
  meta.append(name, count);

  open.append(cover, meta);

  const menu = document.createElement('div');
  menu.className = 'shelf-card-actions';

  const rename = document.createElement('button');
  rename.type = 'button';
  rename.textContent = 'Rename';
  rename.addEventListener('click', async (event) => {
    event.stopPropagation();
    const next = prompt('Rename shelf', summary.name);
    if (next === null) return;
    await api('PATCH', `/${summary.id}`, { name: next });
    await refresh();
    showIndex();
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'danger';
  del.textContent = 'Delete';
  del.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (!confirm(`Delete “${summary.name}” and its ${summary.count} pins?`)) return;
    await api('DELETE', `/${summary.id}`);
    await refresh();
    showIndex();
  });

  menu.append(rename, del);
  card.append(open, menu);
  return card;
}

function setChrome(title, { back = false, everything = true } = {}) {
  titleEl.textContent = title;
  backBtn.hidden = !back;
  everythingBtn.hidden = !everything;
}

function empty(message) {
  const p = document.createElement('p');
  p.className = 'status';
  p.textContent = message;
  return p;
}

export async function showIndex() {
  mode = 'index';
  current = null;
  await refresh();
  setChrome('Shelves', { everything: summaries.length > 0 });
  body.replaceChildren();

  if (!summaries.length) {
    body.append(
      empty('No shelves yet. Collect pins in the stash below, then push them to a shelf.'),
    );
    if (!restoringView) onNavigate();
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'shelf-cards';
  for (const summary of summaries) wrap.append(shelfCard(summary));
  body.append(wrap);
  if (!restoringView) onNavigate();
}

export async function showShelf(id) {
  mode = 'shelf';
  const { shelf } = await api('GET', `/${id}`);
  current = shelf;
  setChrome(shelf.name, { back: true, everything: false });
  body.replaceChildren();
  body.append(
    shelf.pins.length ? grid(shelf.pins, shelf.id) : empty('This shelf is empty.'),
  );
  if (!restoringView) onNavigate();
}

/** Everything you've ever kept, in one scroll. */
export async function showEverything() {
  mode = 'everything';
  current = null;
  const { shelves } = await api('GET', '?full=1');
  setChrome('Everything', { back: true, everything: false });
  body.replaceChildren();

  const total = shelves.reduce((sum, shelf) => sum + shelf.pins.length, 0);
  if (!total) {
    body.append(empty('Nothing saved yet.'));
    if (!restoringView) onNavigate();
    return;
  }

  for (const shelf of shelves) {
    if (!shelf.pins.length) continue;
    const heading = document.createElement('h3');
    heading.className = 'shelves-heading';
    const link = document.createElement('button');
    link.type = 'button';
    link.textContent = shelf.name;
    link.addEventListener('click', () => showShelf(shelf.id));
    const count = document.createElement('span');
    count.textContent = `${shelf.pins.length}`;
    heading.append(link, count);
    body.append(heading, grid(shelf.pins, shelf.id));
  }
  if (!restoringView) onNavigate();
}

export function open() {
  root.hidden = false;
  document.body.classList.add('shelves-open');
  showIndex();
}

export function close() {
  if (root.hidden) return;
  root.hidden = true;
  document.body.classList.remove('shelves-open');
  if (!restoringView) onNavigate();
}

/** Esc unwinds one level at a time rather than closing the whole thing. */
export function back() {
  if (mode === 'index') close();
  else showIndex();
}

/* ---------- history ---------- */

/** What's on screen, as something the URL can carry. */
export function viewState() {
  if (!root || root.hidden) return null;
  if (mode === 'shelf' && current) return { mode: 'shelf', id: current.id };
  return { mode: mode === 'everything' ? 'everything' : 'index' };
}

/** Put the overlay into a state from history, without pushing a new entry. */
export async function applyView(view) {
  restoringView = true;
  try {
    if (!view) {
      close();
      return;
    }
    root.hidden = false;
    document.body.classList.add('shelves-open');
    if (view.mode === 'shelf' && view.id) await showShelf(view.id);
    else if (view.mode === 'everything') await showEverything();
    else await showIndex();
  } finally {
    restoringView = false;
  }
}

export function initShelves(options) {
  root = options.root;
  onOpen = options.onOpen || onOpen;
  onNavigate = options.onNavigate || onNavigate;
  body = root.querySelector('.shelves-body');
  titleEl = root.querySelector('.shelves-title');
  backBtn = root.querySelector('.shelves-back');
  everythingBtn = root.querySelector('.shelves-everything');

  backBtn.addEventListener('click', () => showIndex());
  everythingBtn.addEventListener('click', () => showEverything());
  root.querySelector('.shelves-close').addEventListener('click', close);
  // Clicking the dimmed area behind the panel closes it, like any modal.
  root.addEventListener('pointerdown', (event) => {
    if (event.target === root) close();
  });

  refresh().catch((err) => console.warn(`shelves: ${err.message}`));
}
