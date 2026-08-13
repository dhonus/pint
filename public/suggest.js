// A native <datalist> puts a dropdown arrow inside the input and renders an
// OS-styled popup. This is the same idea drawn as one piece with the search bar.
let input;
let panel;
let form;
let items = [];
let index = -1;
let source = () => [];

export const isSuggesting = () => panel && !panel.hidden;

function pick(value) {
  input.value = value;
  hide();
  form.requestSubmit();
}

function render(list) {
  panel.replaceChildren();
  items = list.map((value, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'suggest-row';
    row.textContent = value;
    // pointerdown, because a click would land after the input's blur.
    row.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      pick(value);
    });
    row.addEventListener('pointerenter', () => highlight(i));
    return row;
  });
  panel.append(...items);
}

function highlight(next) {
  index = next;
  items.forEach((item, i) => item.classList.toggle('active', i === index));
}

export function show() {
  const typed = input.value.trim().toLowerCase();
  const list = source()
    .filter((value) => value.toLowerCase() !== typed)
    .filter((value) => !typed || value.toLowerCase().includes(typed))
    .slice(0, 8);

  if (!list.length) return hide();
  render(list);
  index = -1;
  panel.hidden = false;
}

export function hide() {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  index = -1;
}

/** @returns {boolean} true if the key was consumed */
export function suggestKey(event) {
  if (!isSuggesting()) return false;
  switch (event.key) {
    case 'ArrowDown':
      highlight((index + 1) % items.length);
      return true;
    case 'ArrowUp':
      highlight((index - 1 + items.length) % items.length);
      return true;
    case 'Enter':
      if (index < 0) return false; // let the form submit what was typed
      pick(items[index].textContent);
      return true;
    case 'Escape':
      hide();
      return true;
    default:
      return false;
  }
}

export function initSuggest(options) {
  input = options.input;
  form = options.form;
  source = options.source || source;

  panel = document.createElement('div');
  panel.className = 'suggest';
  panel.hidden = true;
  form.append(panel);

  input.addEventListener('input', show);
  // On `focus`, never `pointerdown`: opening the panel mid-touch mutates the
  // DOM under the finger, iOS re-runs its hit test and drops the focus that
  // tap was about to apply — so the keyboard never appears. Safe to use focus
  // now that boot no longer focuses the field on touch devices.
  input.addEventListener('focus', show);
  input.addEventListener('blur', () => setTimeout(hide, 120));
  input.addEventListener('keydown', (event) => {
    if (suggestKey(event)) event.preventDefault();
  });
}
