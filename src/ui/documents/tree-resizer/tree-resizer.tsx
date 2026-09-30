// The bar between the Documents tree and the editor. Dragging it sets the tree's width.
import './tree-resizer.css';

export function TreeResizer({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const startDrag = (down: React.PointerEvent) => {
    const from = { x: down.clientX, width };
    const move = (e: PointerEvent) => onResize(from.width + e.clientX - from.x);
    window.addEventListener('pointermove', move);
  };
  return <div className="tree-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the Documents tree" onPointerDown={startDrag} />;
}
