const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');
const moreBtn = document.getElementById('more');
const sentinel = document.getElementById('sentinel');

const state = { query: '', bookmark: null, loading: false, done: false };

function setStatus(text) {
  statusEl.textContent = text || '';
  statusEl.hidden = !text;
}

function card(pin) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = pin.full;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';

  const fig = document.createElement('figure');
  fig.style.margin = '0';

  const img = document.createElement('img');
  img.src = pin.thumb;
  img.alt = pin.title || pin.description || 'Pin';
  img.loading = 'lazy';
  // Reserve the right amount of space so the columns don't reflow on load.
  if (pin.width && pin.height) {
    img.width = pin.width;
    img.height = pin.height;
    img.style.aspectRatio = `${pin.width} / ${pin.height}`;
  }
  img.style.backgroundColor = pin.color;
  fig.append(img);

  const label = pin.title || pin.description;
  if (label) {
    const caption = document.createElement('figcaption');
    caption.textContent = label;
    fig.append(caption);
  }

  a.append(fig);
  return a;
}

async function load({ reset = false } = {}) {
  if (state.loading || (state.done && !reset)) return;
  state.loading = true;
  moreBtn.hidden = true;

  if (reset) {
    grid.replaceChildren();
    state.bookmark = null;
    state.done = false;
  }
  setStatus(reset ? 'Searching…' : 'Loading more…');

  try {
    const params = new URLSearchParams({ q: state.query });
    if (state.bookmark) params.set('bookmark', state.bookmark);

    const res = await fetch(`/api/search?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

    const frag = document.createDocumentFragment();
    for (const pin of data.pins) frag.append(card(pin));
    grid.append(frag);

    state.bookmark = data.bookmark;
    state.done = !data.bookmark;

    if (!grid.childElementCount) setStatus(`No results for “${state.query}”.`);
    else setStatus(state.done ? 'End of results.' : '');
    moreBtn.hidden = state.done;
  } catch (err) {
    setStatus(err.message);
    // Let the user retry rather than silently dead-ending the feed.
    moreBtn.hidden = !state.bookmark && !grid.childElementCount;
  } finally {
    state.loading = false;
  }
}

function search(query, { push = true } = {}) {
  state.query = query;
  input.value = query;
  document.title = query ? `${query} · pint` : 'pint';
  if (push) {
    const url = query ? `/?q=${encodeURIComponent(query)}` : '/';
    history.pushState({ query }, '', url);
  }
  if (!query) {
    grid.replaceChildren();
    moreBtn.hidden = true;
    setStatus('Type something above to start searching.');
    return;
  }
  load({ reset: true });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (query) search(query);
});

moreBtn.addEventListener('click', () => load());

// Infinite scroll: fire when the sentinel below the grid comes into view.
new IntersectionObserver(
  (entries) => {
    if (entries.some((e) => e.isIntersecting) && state.query && !state.done) load();
  },
  { rootMargin: '600px' },
).observe(sentinel);

window.addEventListener('popstate', () => {
  search(new URLSearchParams(location.search).get('q') || '', { push: false });
});

search(new URLSearchParams(location.search).get('q') || '', { push: false });
