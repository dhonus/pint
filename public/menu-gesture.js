// Right-click, or a long press on touch, opens the shelf menu for a pin.
// Shared so every surface showing a pin behaves the same way.
const LONG_PRESS_MS = 420;

/**
 * @param {HTMLElement} el
 * @param {() => object} getPin resolved at gesture time, so a tile whose pin
 *   changes underneath it still opens the right menu.
 * @param {{activate?: () => void}} [options]
 * @returns {{consumed: () => boolean}} whether a long press just fired, so the
 *   click that follows it can be ignored.
 */
export function attachMenuGesture(el, getPin, { activate } = {}) {
  let timer = null;
  let fired = false;

  const dispatch = (x, y) => {
    activate?.();
    el.dispatchEvent(
      new CustomEvent('pin:menu', { bubbles: true, detail: { pin: getPin(), x, y } }),
    );
  };

  el.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    dispatch(event.clientX, event.clientY);
  });

  el.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    fired = false;
    timer = setTimeout(() => {
      fired = true;
      dispatch(event.clientX, event.clientY);
    }, LONG_PRESS_MS);
  });

  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  // Any movement means a scroll, not a press.
  el.addEventListener('pointermove', cancel, { passive: true });

  return {
    consumed() {
      const was = fired;
      fired = false;
      return was;
    },
  };
}
