import { shelf } from './shelf.js';
import { shelvesFor, onShelvesChange } from './shelves.js';
import { setActivePin } from './active.js';

// Whatever the pointer or keyboard focus is on. Lets `S` and `Space` act on the
// pin you're looking at without a click first.

/** Reflect stash membership on every rendered card at once. */
shelf.subscribe(() => {
  for (const el of document.querySelectorAll('.card[data-id]')) {
    el.classList.toggle('shelved', shelf.has(el.dataset.id));
  }
});

/** Same for saved shelves, which is a different thing from the stash. */
onShelvesChange(() => {
  for (const el of document.querySelectorAll('.card[data-id]')) markSaved(el, el.dataset.id);
});

// How long a touch must rest on a pin before the shelf menu opens.
const LONG_PRESS_MS = 420;

const BOOKMARK =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M6 2h12a1 1 0 0 1 1 1v18l-7-4-7 4V3a1 1 0 0 1 1-1z"/></svg>';

function markSaved(card, id) {
  const names = shelvesFor(id);
  card.classList.toggle('saved', names.length > 0);
  const badge = card.querySelector('.card-saved');
  if (!badge) return;
  // Names go in the title attribute, never into markup.
  badge.title = names.length ? `In ${names.join(', ')}` : '';
  badge.innerHTML = BOOKMARK + (names.length > 1 ? `<b>${names.length}</b>` : '');
}

/**
 * Build a pin card.
 * @param {object} pin
 * @param {{onOpen?: (pin: object) => void, size?: 'grid'|'sub'}} options
 */
export function createCard(pin, { onOpen, size = 'grid' } = {}) {
  const card = document.createElement('figure');
  card.className = `card card-${size}`;
  card.dataset.id = pin.id;
  card.classList.toggle('shelved', shelf.has(pin.id));

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'card-open';
  open.setAttribute('aria-label', pin.title || 'Open pin');

  const img = document.createElement('img');
  img.src = pin.thumb;
  img.alt = pin.title || pin.description || '';
  img.loading = 'lazy';
  img.draggable = false;
  // Reserve the right space so columns don't reflow as images arrive.
  if (pin.width && pin.height) {
    img.width = pin.width;
    img.height = pin.height;
    img.style.aspectRatio = `${pin.width} / ${pin.height}`;
  }
  img.style.backgroundColor = pin.color;
  open.append(img);

  // A long press is the touch equivalent of right-click; the tap that follows
  // it must not also open the pin.
  let pressTimer = null;
  let pressFired = false;

  open.addEventListener('click', () => {
    if (pressFired) {
      pressFired = false;
      return;
    }
    onOpen?.(pin);
  });
  card.append(open);

  card.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    pressFired = false;
    pressTimer = setTimeout(() => {
      pressFired = true;
      setActivePin(pin, card);
      card.dispatchEvent(
        new CustomEvent('pin:menu', {
          bubbles: true,
          detail: { pin, x: event.clientX, y: event.clientY },
        }),
      );
    }, LONG_PRESS_MS);
  });

  const cancelPress = () => clearTimeout(pressTimer);
  card.addEventListener('pointerup', cancelPress);
  card.addEventListener('pointercancel', cancelPress);
  // Any movement means a scroll, not a press.
  card.addEventListener('pointermove', cancelPress, { passive: true });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'card-shelf';
  save.title = 'Add to shelf (S)';
  save.setAttribute('aria-label', 'Add to shelf');
  save.addEventListener('click', (event) => {
    event.stopPropagation();
    shelf.toggle(pin);
  });
  card.append(save);

  // Always present, only visible once the pin is in a shelf.
  const saved = document.createElement('span');
  saved.className = 'card-saved';
  card.append(saved);
  markSaved(card, pin.id);

  if (pin.title) {
    const caption = document.createElement('figcaption');
    caption.textContent = pin.title;
    card.append(caption);
  }

  const activate = () => setActivePin(pin, card);
  card.addEventListener('pointerenter', activate);
  card.addEventListener('focusin', activate);

  // Right-click files the pin somewhere saved. Dispatched rather than handled
  // here, so cards don't need to know the picker exists.
  card.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    activate();
    card.dispatchEvent(
      new CustomEvent('pin:menu', {
        bubbles: true,
        // No anchor: a context menu belongs at the cursor. Holding `s` is the
        // one that hangs off the pin's `+`.
        detail: { pin, x: event.clientX, y: event.clientY },
      }),
    );
  });

  return card;
}

/** Append pins to a container in one paint. */
export function appendCards(container, pins, options) {
  const frag = document.createDocumentFragment();
  for (const pin of pins) frag.append(createCard(pin, options));
  container.append(frag);
}
