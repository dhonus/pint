import { getActivePin } from './cards.js';

// Hold Space to enlarge whatever you're pointing at, release to dismiss.
// Most looks shouldn't even cost a click.
let el;
let img;
let label;
let open = false;

export const isPeeking = () => open;

export function initPeek() {
  el = document.createElement('div');
  el.className = 'peek';
  el.hidden = true;
  el.innerHTML = '<img alt="" /><p></p>';
  img = el.querySelector('img');
  label = el.querySelector('p');
  document.body.append(el);

  addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat) return;
    if (event.target.matches('input, textarea')) return;
    const pin = getActivePin();
    if (!pin) return;
    event.preventDefault();
    show(pin);
  });

  addEventListener('keyup', (event) => {
    if (event.code === 'Space') hide();
  });

  // Releasing the key outside the window would otherwise leave it stuck open.
  addEventListener('blur', hide);
}

function show(pin) {
  img.src = pin.large || pin.thumb;
  img.style.backgroundColor = pin.color;
  if (pin.width && pin.height) img.style.aspectRatio = `${pin.width} / ${pin.height}`;
  label.textContent = pin.title || '';
  label.hidden = !pin.title;
  el.hidden = false;
  open = true;
}

export function hide() {
  if (!open) return;
  el.hidden = true;
  img.removeAttribute('src');
  open = false;
}
