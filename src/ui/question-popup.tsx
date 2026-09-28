// The speech bubble a question pill opens: the AI's question about a highlighted passage, and a way to answer it.
// It knows only the passage; the page decides when it is open and what sending does.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Passage } from '../shared/wire';
import './question-popup.css';

// How far the bubble keeps from the window's edges, and from its pill.
const EDGE = 8;
const GAP = 10;

// The nearest ancestor of `el` that scrolls, whose visible box a pill must stay in; the window if none does.
function scrollBoxOf(el: HTMLElement): { top: number; bottom: number } {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent.getBoundingClientRect();
  }
  return { top: 0, bottom: window.innerHeight };
}

export function QuestionPopup({
  passage,
  anchor,
  busy,
  text,
  onText,
  onSend,
  onClose,
}: {
  passage: Passage;
  // The pill the writer clicked.
  anchor: HTMLElement;
  // A turn is running, so nothing can be sent yet.
  busy: boolean;
  // What the discussion box holds; the page keeps it.
  text: string;
  onText: (text: string) => void;
  // Sends the writer's message, label first.
  onSend: (message: string) => void;
  onClose: () => void;
}) {
  const bubble = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const headingId = useId();
  const questionId = useId();

  // Below the pill, or above it near the window's bottom, kept inside the window, with the arrow on the pill's
  // centre. A pill scrolled out of its editor's view closes the bubble.
  useLayoutEffect(() => {
    const place = () => {
      const el = bubble.current!;
      const pill = anchor.getBoundingClientRect();
      const view = scrollBoxOf(anchor);
      if (pill.bottom < view.top || pill.top > view.bottom) return onCloseRef.current();
      const { width, height } = el.getBoundingClientRect();
      const below = pill.bottom + GAP + height <= window.innerHeight - EDGE || pill.top - GAP - height < EDGE;
      const centre = pill.left + pill.width / 2;
      const left = Math.max(EDGE, Math.min(centre - width / 2, window.innerWidth - EDGE - width));
      el.style.top = `${below ? pill.bottom + GAP : pill.top - GAP - height}px`;
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

  // A press anywhere but the bubble and its pill closes it, and so does the pill leaving the page, which it does
  // when an edit removes its passage.
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

  // Where focus goes back to: the pill, or the editor it sat in once a later edit removed it.
  const [editor] = useState(() => anchor.closest<HTMLElement>('.ProseMirror'));
  const focusBack = () => (anchor.isConnected ? anchor : editor)?.focus();
  const close = () => {
    focusBack();
    onClose();
  };
  const send = (message: string) => {
    focusBack();
    onSend(message);
  };
  const discuss = () => {
    if (!busy && text.trim()) send(`${passage.label} — ${text.trim()}`);
  };

  return (
    <div
      ref={bubble}
      className="question-popup"
      role="dialog"
      aria-labelledby={headingId}
      aria-describedby={questionId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div className="question-popup-head">
        <h2 id={headingId}>{passage.label}</h2>
        <button type="button" className="question-popup-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      <p id={questionId}>{passage.question ?? `See ${passage.label} in the chat.`}</p>
      <button type="button" className="primary" disabled={busy} onClick={() => send(`${passage.label} — I accept the suggestions.`)}>
        Accept suggestions
      </button>
      <div className="question-popup-discuss">
        <textarea
          autoFocus
          rows={2}
          aria-label={`Discuss ${passage.label}`}
          placeholder="Discuss the suggestions…"
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            // Enter mid-composition picks an input method's candidate; it is not a send.
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            discuss();
          }}
        />
        <button type="button" disabled={busy} onClick={discuss}>
          Send
        </button>
      </div>
      {busy && <p className="small muted">Waiting for the AI to finish replying</p>}
    </div>
  );
}
