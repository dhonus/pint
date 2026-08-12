import { getActivePin } from './active.js';

// Hold Space to enlarge whatever you're pointing at, release to dismiss.
// Most looks shouldn't even cost a click.
let el;
let img;
let label;
let open = false;
// Zoom (from the shelf) stays up until dismissed, unlike hold-to-peek.
let sticky = false;

let current = null;

export const isPeeking = () => open;
/** Only a click-zoom can be stepped through with the arrow keys. */
export const isZooming = () => open && sticky;
export const currentPin = () => current;

// A keydown can target `document` or `window`, which have no `.matches`.
const isTyping = (target) =>
  target instanceof Element && target.matches('input, textarea, [contenteditable]');

export function initPeek() {
  el = document.createElement('div');
  el.className = 'peek';
  el.hidden = true;
  el.innerHTML = '<img alt="" /><p></p>';
  img = el.querySelector('img');
  label = el.querySelector('p');
  el.addEventListener('click', hide);
  document.body.append(el);

  addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || isTyping(event.target)) return;
    const pin = getActivePin();
    if (!pin && !open) return;
    // Must run on repeats too, or the page scrolls the whole time it's held.
    event.preventDefault();
    if (event.repeat || open) return;
    show(pin);
  });

  addEventListener('keyup', (event) => {
    if (event.code === 'Space' && !sticky) hide();
  });

  // Releasing the key outside the window would otherwise leave it stuck open.
  addEventListener('blur', hide);
}

function show(pin) {
  current = pin;
  img.src = pin.full || pin.large || pin.thumb;
  img.style.backgroundColor = pin.color;
  if (pin.width && pin.height) img.style.aspectRatio = `${pin.width} / ${pin.height}`;
  label.textContent = pin.title || '';
  label.hidden = !pin.title;
  el.hidden = false;
  open = true;
}

/** Click-to-zoom: stays open until dismissed with Esc or another click. */
export function zoom(pin) {
  show(pin);
  sticky = true;
  el.classList.add('sticky');
}

export function hide() {
  if (!open) return;
  el.hidden = true;
  el.classList.remove('sticky');
  img.removeAttribute('src');
  open = false;
  sticky = false;
  current = null;
}
