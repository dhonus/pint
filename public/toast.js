// Brief confirmation so filing a pin doesn't need a dialog.
let el;
let timer;

export function toast(message, { error = false } = {}) {
  el ||= document.getElementById('toast');
  if (!el) return;

  el.textContent = message;
  el.classList.toggle('error', error);
  el.hidden = false;
  // Restart the animation even if a toast is already showing.
  el.classList.remove('in');
  void el.offsetWidth;
  el.classList.add('in');

  clearTimeout(timer);
  timer = setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => {
      el.hidden = true;
    }, 220);
  }, 1900);
}
