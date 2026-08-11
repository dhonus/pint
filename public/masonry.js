/**
 * Column masonry that only ever *appends*.
 *
 * CSS `column-count` redistributes every item across the columns whenever
 * content is added, so lazy-loading a page shuffles everything above and you
 * lose your place. Here each column is its own element: a new card goes to the
 * shortest one and nothing already on screen moves.
 */
export function createMasonry(container, { gap = 16, minColumn = 230 } = {}) {
  const items = [];
  let columns = [];

  container.classList.add('masonry');
  container.style.setProperty('--masonry-gap', `${gap}px`);

  const width = () => container.clientWidth || container.getBoundingClientRect().width;

  function targetCount() {
    const available = width();
    if (!available) return columns.length || 1;
    return Math.max(1, Math.floor((available + gap) / (minColumn + gap)));
  }

  function build(count) {
    columns = [];
    container.replaceChildren();
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'masonry-col';
      container.append(el);
      columns.push({ el, height: 0 });
    }
  }

  /**
   * Predict height from the aspect ratio instead of measuring, so placing a
   * batch doesn't force a layout per card. Real heights are synced after paint.
   */
  function estimate(item) {
    const columnWidth = columns[0]?.el.clientWidth || width() || 240;
    const ratio = item.width && item.height ? item.height / item.width : 1.3;
    return columnWidth * ratio + (item.hasCaption ? 36 : 0);
  }

  function place(item) {
    const shortest = columns.reduce((a, b) => (b.height < a.height ? b : a));
    shortest.el.append(item.el);
    shortest.height += estimate(item) + gap;
  }

  /** Replace predictions with what actually rendered, so balance stays honest. */
  function syncHeights() {
    requestAnimationFrame(() => {
      for (const column of columns) column.height = column.el.offsetHeight;
    });
  }

  function relayout() {
    build(targetCount());
    for (const item of items) place(item);
    syncHeights();
  }

  build(targetCount());

  // Only a change in column count needs a rebuild; plain width changes reflow
  // inside the existing columns on their own.
  if (typeof ResizeObserver !== 'undefined') {
    let last = columns.length;
    new ResizeObserver(() => {
      const next = targetCount();
      if (next !== last) {
        last = next;
        relayout();
      }
    }).observe(container);
  }

  return {
    /**
     * @param {object[]} pins
     * @param {(pin: object, indexInBatch: number) => HTMLElement} render
     */
    append(pins, render) {
      for (const [offset, pin] of pins.entries()) {
        const item = {
          el: render(pin, offset),
          width: pin.width,
          height: pin.height,
          hasCaption: Boolean(pin.title),
        };
        items.push(item);
        place(item);
      }
      syncHeights();
    },

    clear() {
      items.length = 0;
      build(targetCount());
    },

    count: () => items.length,
  };
}
