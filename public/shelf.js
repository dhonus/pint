// The shelf is the point of the whole app: collect pins while digging, without
// ever losing the dig. It survives reloads.
const KEY = 'pint.shelf';

let items = load();
const listeners = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Quota or private mode — the shelf still works for this session.
  }
  for (const fn of listeners) fn(items);
}

/** Keep only what's needed to render a card, so storage stays small. */
function slim(pin) {
  const { id, title, thumb, large, full, color, width, height, pinUrl, link, domain } = pin;
  return { id, title, thumb, large, full, color, width, height, pinUrl, link, domain };
}

export const shelf = {
  list: () => items,
  count: () => items.length,
  has: (id) => items.some((item) => item.id === id),

  add(pin) {
    if (shelf.has(pin.id)) return false;
    items = [slim(pin), ...items];
    persist();
    return true;
  },

  remove(id) {
    items = items.filter((item) => item.id !== id);
    persist();
  },

  /** @returns {boolean} true if the pin is now on the shelf. */
  toggle(pin) {
    if (shelf.has(pin.id)) {
      shelf.remove(pin.id);
      return false;
    }
    return shelf.add(pin);
  },

  clear() {
    items = [];
    persist();
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
