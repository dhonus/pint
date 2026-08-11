import { shelf } from './shelf.js';

// Whatever the pointer or keyboard focus is on. Lets `S` and `Space` act on the
// pin you're looking at without a click first.
let activePin = null;
export const getActivePin = () => activePin;

/** Reflect shelf membership on every rendered card at once. */
shelf.subscribe(() => {
  for (const el of document.querySelectorAll('.card[data-id]')) {
    el.classList.toggle('shelved', shelf.has(el.dataset.id));
  }
});

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

  open.addEventListener('click', () => onOpen?.(pin));
  card.append(open);

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

  if (pin.title) {
    const caption = document.createElement('figcaption');
    caption.textContent = pin.title;
    card.append(caption);
  }

  const activate = () => {
    activePin = pin;
  };
  card.addEventListener('pointerenter', activate);
  card.addEventListener('focusin', activate);

  return card;
}

/** Append pins to a container in one paint. */
export function appendCards(container, pins, options) {
  const frag = document.createDocumentFragment();
  for (const pin of pins) frag.append(createCard(pin, options));
  container.append(frag);
}
