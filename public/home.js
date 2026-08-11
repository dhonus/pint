// The empty state. Somewhere to start, and a way back to what you were just
// looking at.
const KEY = 'pint.recent';
const LIMIT = 10;

const STARTERS = [
  'winter outfits',
  'street style',
  'capsule wardrobe',
  'mid-century interiors',
  'small kitchen ideas',
  'film photography',
  'book nooks',
  'ceramics',
  'trail running',
  'garden paths',
];

let onPick = () => {};
let recentBlock;
let recentEl;
let homeEl;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(raw) ? raw.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private mode — recents just won't persist.
  }
}

/** Most recent first, no duplicates. */
export function remember(query) {
  const trimmed = query.trim();
  if (!trimmed) return;
  const list = [trimmed, ...load().filter((item) => item !== trimmed)].slice(0, LIMIT);
  save(list);
  renderRecent();
}

function chip(label, { subtle = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = subtle ? 'chip chip-subtle' : 'chip';
  button.textContent = label;
  button.addEventListener('click', () => onPick(label));
  return button;
}

function renderRecent() {
  const list = load();
  recentBlock.hidden = list.length === 0;
  recentEl.replaceChildren();
  for (const query of list) recentEl.append(chip(query, { subtle: true }));
}

export function initHome(options) {
  homeEl = options.home;
  onPick = options.onPick || onPick;
  recentBlock = document.getElementById('recent-block');
  recentEl = document.getElementById('recent');

  const suggestions = document.getElementById('suggestions');
  for (const query of STARTERS) suggestions.append(chip(query));
  renderRecent();
}

export function showHome(visible) {
  homeEl.hidden = !visible;
}
