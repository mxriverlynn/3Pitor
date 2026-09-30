// The bar at a panel's edge. Dragging it, or pressing the arrow keys on it, sets the panel's width, from `min` to `max`.
import './panel-resizer.css';

// `panelOn` is the side of the bar the panel is on: moving the bar away from that side widens the panel.
type Props = { label: string; width: number; min: number; max: number; panelOn?: 'left' | 'right'; onResize: (width: number) => void };

export function PanelResizer({ label, width, min, max, panelOn = 'left', onResize }: Props) {
  const clamp = (to: number) => Math.min(max, Math.max(min, to));
  const away = panelOn === 'left' ? 1 : -1;
  // A drag follows the pointer anywhere on the page, not only over the bar, until the pointer is let go.
  const startDrag = (down: React.PointerEvent) => {
    // Only the main button: a right-click opens a menu that can swallow the release, leaving the drag stuck.
    if (down.button !== 0) return;
    // Left alone, the press starts a text selection that grows as the pointer sweeps over the page.
    down.preventDefault();
    const from = { x: down.clientX, width };
    const drag = new AbortController();
    const end = () => drag.abort();
    window.addEventListener('pointermove', (e) => onResize(clamp(from.width + away * (e.clientX - from.x))), { signal: drag.signal });
    window.addEventListener('pointerup', end, { signal: drag.signal });
    window.addEventListener('pointercancel', end, { signal: drag.signal });
  };
  // From the keyboard, each arrow press moves the bar 10px.
  const step = (e: React.KeyboardEvent) => {
    const by = { ArrowLeft: -10, ArrowRight: 10 }[e.key];
    if (!by) return;
    e.preventDefault();
    onResize(clamp(width + away * by));
  };
  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={step}
    />
  );
}
