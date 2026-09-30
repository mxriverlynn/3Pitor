// The bar between the Documents tree and the editor. Dragging it, or pressing the arrow keys on it, sets the tree's width.
import './tree-resizer.css';

// The narrowest the tree can be and still show a name, and the widest before it crowds out the editor.
const MIN = 120;
const MAX = 600;
const clamp = (width: number) => Math.min(MAX, Math.max(MIN, width));

export function TreeResizer({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  // A drag follows the pointer anywhere on the page, not only over the bar, until the pointer is let go.
  const startDrag = (down: React.PointerEvent) => {
    // Only the main button: a right-click opens a menu that can swallow the release, leaving the drag stuck.
    if (down.button !== 0) return;
    // Left alone, the press starts a text selection that grows as the pointer sweeps over the page.
    down.preventDefault();
    const from = { x: down.clientX, width };
    const drag = new AbortController();
    const end = () => drag.abort();
    window.addEventListener('pointermove', (e) => onResize(clamp(from.width + e.clientX - from.x)), { signal: drag.signal });
    window.addEventListener('pointerup', end, { signal: drag.signal });
    window.addEventListener('pointercancel', end, { signal: drag.signal });
  };
  // From the keyboard, each arrow press moves the bar 10px.
  const step = (e: React.KeyboardEvent) => {
    const by = { ArrowLeft: -10, ArrowRight: 10 }[e.key];
    if (!by) return;
    e.preventDefault();
    onResize(clamp(width + by));
  };
  return (
    <div
      className="tree-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the Documents tree"
      aria-valuenow={width}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={step}
    />
  );
}
