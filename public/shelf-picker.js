import {
  listSummaries,
  addToShelf,
  removeFromShelf,
  saveAsShelf,
  shelvesFor,
  refresh,
} from './shelves.js';
import { shelf } from './shelf.js';
import { toast } from './toast.js';

// Hold `s` or right-click a pin to file it straight into a saved shelf.
// A tap still just drops it in the stash — this is the deliberate version.
let el;
let pin = null;
let items = [];
let index = -1;

export const isPickerOpen = () => el && !el.hidden;

function build() {
  el = document.createElement('div');
  el.className = 'picker';
  el.hidden = true;
  el.innerHTML = '<div class="picker-head"></div><div class="picker-list"></div>';
  document.body.append(el);

  // Clicking anywhere else dismisses, but not the click that opened it.
  addEventListener('pointerdown', (event) => {
    if (isPickerOpen() && !el.contains(event.target)) close();
  });
  addEventListener('resize', close);
  addEventListener('scroll', close, true);
}

function row({ label, hint, onPick, className = '' }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `picker-row ${className}`.trim();
  const name = document.createElement('span');
  name.textContent = label;
  button.append(name);
  if (hint) {
    const meta = document.createElement('em');
    meta.textContent = hint;
    button.append(meta);
  }
  button.addEventListener('click', () => {
    close();
    onPick();
  });
  return button;
}

function highlight(next) {
  index = next;
  items.forEach((item, i) => item.classList.toggle('active', i === index));
  items[index]?.scrollIntoView({ block: 'nearest' });
}

// These run after close(), which clears the module's `pin`, so every handler
// takes the pin it was built for rather than reading shared state.
async function fileInto(target, shelfId, name) {
  try {
    await addToShelf(shelfId, [target]);
    toast(`Added to ${name}`);
  } catch (err) {
    toast(`Could not add: ${err.message}`, { error: true });
  }
}

async function takeOut(target, shelfId, name) {
  try {
    await removeFromShelf(shelfId, target.id);
    toast(`Removed from ${name}`);
  } catch (err) {
    toast(`Could not remove: ${err.message}`, { error: true });
  }
}

async function fileIntoNew(target) {
  const name = prompt('New shelf named:', '');
  if (name === null) return;
  try {
    const created = await saveAsShelf(name, [target]);
    toast(`Created ${created.name}`);
  } catch (err) {
    toast(`Could not create: ${err.message}`, { error: true });
  }
}

/** Paint a set of rows into the menu and show it. */
function show(headText, rows, at) {
  el.querySelector('.picker-head').textContent = headText;
  const list = el.querySelector('.picker-list');
  list.replaceChildren();
  items = rows;
  list.append(...rows);

  el.hidden = false;
  el.classList.add('opening');
  place(at);
  highlight(0);
  requestAnimationFrame(() => el.classList.remove('opening'));
}

/**
 * Push the whole stash into one shelf, so a pile you've gathered while digging
 * lands somewhere permanent without naming a new shelf.
 */
export function openStashMenu(pins, at) {
  if (!el) build();
  if (!pins.length) return;
  pin = null;

  const rows = [
    row({
      label: 'New shelf…',
      className: 'picker-new',
      onPick: async () => {
        const name = prompt(`Save ${pins.length} pins as a shelf named:`, '');
        if (name === null) return;
        try {
          const created = await saveAsShelf(name, pins);
          shelf.clear();
          toast(`Saved ${pins.length} to ${created.name}`);
        } catch (err) {
          toast(`Could not save: ${err.message}`, { error: true });
        }
      },
    }),
    ...listSummaries().map((summary) =>
      row({
        label: summary.name,
        hint: String(summary.count),
        onPick: async () => {
          try {
            await addToShelf(summary.id, pins);
            shelf.clear();
            toast(`Pushed ${pins.length} to ${summary.name}`);
          } catch (err) {
            toast(`Could not push: ${err.message}`, { error: true });
          }
        },
      }),
    ),
  ];

  show(`Push ${pins.length} ${pins.length === 1 ? 'pin' : 'pins'} to…`, rows, at);
}

/**
 * @param {{x: number, y: number}} at viewport coordinates to anchor to
 * @param {{revalidate?: boolean}} [options] internal — guards the redraw below
 *   from refreshing again and recursing forever.
 */
export async function openPicker(target, at, { revalidate = true } = {}) {
  if (!el) build();
  pin = target;

  const rows = [];

  const stashed = shelf.has(target.id);
  rows.push(
    row({
      label: stashed ? 'Remove from stash' : 'Add to stash',
      hint: 'S',
      className: 'picker-stash',
      onPick: () => {
        const added = shelf.toggle(target);
        toast(added ? 'Added to stash' : 'Removed from stash');
      },
    }),
    row({ label: 'New shelf…', className: 'picker-new', onPick: () => fileIntoNew(target) }),
  );

  // Show it immediately with what we have, then fill in fresh counts.
  const already = new Set(shelvesFor(target.id));
  for (const summary of listSummaries()) {
    const has = already.has(summary.name);
    rows.push(
      row({
        label: summary.name,
        // A tick beats a count when the answer to "is it in here?" is yes.
        hint: has ? '✓' : String(summary.count),
        className: has ? 'picker-has' : '',
        onPick: () =>
          has
            ? takeOut(target, summary.id, summary.name)
            : fileInto(target, summary.id, summary.name),
      }),
    );
  }

  show(target.title || 'Untitled pin', rows, at);

  // Counts may be stale if another tab touched them; refresh quietly and
  // redraw once, without kicking off another refresh.
  if (revalidate) {
    refresh()
      .then(() => {
        if (isPickerOpen() && pin === target) openPicker(target, at, { revalidate: false });
      })
      .catch(() => {});
  }
}

/**
 * Hang the menu off the pin's own `+` button so the gesture stays connected to
 * the thing you pressed, flipping above it when there's no room below.
 * Falls back to a bare point when there's no anchor (right-click elsewhere).
 */
function place(at) {
  const margin = 10;
  const rect = el.getBoundingClientRect();
  let x;
  let y;
  let origin = 'top left';

  if (at.anchor?.isConnected) {
    const from = at.anchor.getBoundingClientRect();
    // Right edges line up, so it unfolds leftward from the button.
    x = from.right - rect.width;
    const below = from.bottom + 8;
    const flip = below + rect.height > innerHeight - margin && from.top - rect.height - 8 > margin;
    y = flip ? from.top - rect.height - 8 : below;
    origin = flip ? 'bottom right' : 'top right';
  } else {
    // Just below and right of the pointer, flipping up near the bottom edge.
    x = at.x + 2;
    const below = at.y + 6;
    const flip = below + rect.height > innerHeight - margin && at.y - rect.height - 6 > margin;
    y = flip ? at.y - rect.height - 6 : below;
    origin = flip ? 'bottom left' : 'top left';
  }

  el.style.transformOrigin = origin;
  el.style.left = `${Math.min(Math.max(margin, x), innerWidth - rect.width - margin)}px`;
  el.style.top = `${Math.min(Math.max(margin, y), innerHeight - rect.height - margin)}px`;
}

export function close() {
  if (!isPickerOpen()) return;
  el.hidden = true;
  pin = null;
  items = [];
  index = -1;
}

/** @returns {boolean} true if the key was consumed */
export function pickerKey(event) {
  if (!isPickerOpen()) return false;
  switch (event.key) {
    case 'ArrowDown':
      highlight((index + 1) % items.length);
      return true;
    case 'ArrowUp':
      highlight((index - 1 + items.length) % items.length);
      return true;
    case 'Enter':
      items[index]?.click();
      return true;
    case 'Escape':
      close();
      return true;
    default:
      return false;
  }
}
