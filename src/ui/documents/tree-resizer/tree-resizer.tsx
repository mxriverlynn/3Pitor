// The bar between the Documents tree and the editor. Dragging it sets the tree's width.
import './tree-resizer.css';

export function TreeResizer({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  // A drag follows the pointer anywhere on the page, not only over the bar, until the pointer is let go.
  const startDrag = (down: React.PointerEvent) => {
    // Otherwise the press starts a text selection that grows as the pointer sweeps over the page.
    down.preventDefault();
    const from = { x: down.clientX, width };
    const drag = new AbortController();
    const end = () => drag.abort();
    window.addEventListener('pointermove', (e) => onResize(from.width + e.clientX - from.x), { signal: drag.signal });
    window.addEventListener('pointerup', end, { signal: drag.signal });
    window.addEventListener('pointercancel', end, { signal: drag.signal });
  };
  return <div className="tree-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the Documents tree" onPointerDown={startDrag} />;
}
