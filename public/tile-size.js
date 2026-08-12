// One size setting shared by the shelf and compare grids, remembered between
// visits. Drives a CSS variable rather than re-laying anything out in JS.
const KEY = 'pint.tile';
const MIN = 110;
const MAX = 460;
const DEFAULT = 190;

const inputs = new Set();
let size = load();

function load() {
  const stored = Number(localStorage.getItem(KEY));
  return Number.isFinite(stored) && stored >= MIN && stored <= MAX ? stored : DEFAULT;
}

function apply() {
  document.documentElement.style.setProperty('--tile', `${size}px`);
}

function set(next) {
  size = Math.min(MAX, Math.max(MIN, next));
  try {
    localStorage.setItem(KEY, String(size));
  } catch {
    // Private mode — it just won't be remembered.
  }
  apply();
  // Keep every slider in step, since two of them can be on screen at once.
  for (const input of inputs) input.value = String(size);
}

/** Wire a range input to the shared size. */
export function initTileSize(input) {
  input.type = 'range';
  input.min = String(MIN);
  input.max = String(MAX);
  input.step = '10';
  input.value = String(size);
  input.addEventListener('input', () => set(Number(input.value)));
  inputs.add(input);
  apply();
}
