// A speech bubble pinned to an element in the page, shared by the popups the editor's buttons open. It places the
// bubble by its anchor and closes it when the writer presses elsewhere or the anchor goes away.
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import './anchored-bubble.css';

// How far the bubble keeps from the window's edges, and from its anchor.
const EDGE = 8;
const GAP = 10;

// The nearest ancestor of `el` that scrolls, whose visible box an anchor must stay in; the window if none does.
function scrollBoxOf(el: HTMLElement): { top: number; bottom: number } {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent.getBoundingClientRect();
  }
  return { top: 0, bottom: window.innerHeight };
}

// Places `bubble` below `anchor`, or above it near the window's bottom, kept inside the window, with the arrow on
// the anchor's centre. It calls `onClose` when the anchor is scrolled out of view or leaves the page, and on a
// press anywhere but the bubble and its anchor. The bubble needs the `bubble` class.
export function useAnchoredBubble(bubble: RefObject<HTMLElement | null>, anchor: HTMLElement, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const el = bubble.current!;
      const box = anchor.getBoundingClientRect();
      const view = scrollBoxOf(anchor);
      if (box.bottom < view.top || box.top > view.bottom) return onCloseRef.current();
      const { width, height } = el.getBoundingClientRect();
      const below = box.bottom + GAP + height <= window.innerHeight - EDGE || box.top - GAP - height < EDGE;
      const centre = box.left + box.width / 2;
      const left = Math.max(EDGE, Math.min(centre - width / 2, window.innerWidth - EDGE - width));
      el.style.top = `${below ? box.bottom + GAP : box.top - GAP - height}px`;
      el.style.left = `${left}px`;
      el.style.setProperty('--arrow-x', `${centre - left}px`);
      el.dataset.side = below ? 'below' : 'above';
    };
    place();
    // Capturing catches the editor's own scrolling, which does not bubble to the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  useEffect(() => {
    const press = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!bubble.current?.contains(target) && !anchor.contains(target)) onCloseRef.current();
    };
    const gone = new MutationObserver(() => {
      if (!anchor.isConnected) onCloseRef.current();
    });
    document.addEventListener('mousedown', press);
    gone.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener('mousedown', press);
      gone.disconnect();
    };
  }, [anchor]);
}
