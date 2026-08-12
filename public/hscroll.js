// Horizontal strips scroll without a visible bar. The edges fade instead — but
// only on the side that actually has more content, otherwise the fade sits over
// the first thumbnail and looks like something is covering it.
function update(el) {
  const max = el.scrollWidth - el.clientWidth;
  el.classList.toggle('can-left', el.scrollLeft > 2);
  el.classList.toggle('can-right', el.scrollLeft < max - 2);
}

export function initHScroll(el) {
  if (el.dataset.hscroll) return;
  el.dataset.hscroll = '1';

  el.addEventListener('scroll', () => update(el), { passive: true });

  // A trackpad's vertical gesture should still move a horizontal strip.
  el.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaX !== 0 || !event.deltaY) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    },
    { passive: false },
  );

  // Contents change as pins are stashed and searches return guides.
  new ResizeObserver(() => update(el)).observe(el);
  new MutationObserver(() => update(el)).observe(el, { childList: true });
  update(el);
}

export function initAllHScroll() {
  for (const el of document.querySelectorAll('.hscroll')) initHScroll(el);
}
