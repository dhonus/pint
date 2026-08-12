// Whatever the pointer or keyboard focus is on. Lives on its own so the card,
// shelf and picker modules can all read it without importing each other.
let activePin = null;
let activeCard = null;

export const getActivePin = () => activePin;
/** The element under the cursor, so a hold can show progress on it. */
export const getActiveCard = () => activeCard;

export function setActivePin(pin, card = null) {
  activePin = pin;
  activeCard = card;
}
