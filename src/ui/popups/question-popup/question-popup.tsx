// The speech bubble a question pill opens: the AI's question about a highlighted passage, and a box to answer it.
// It knows only the passage; the page decides when it is open and what sending does.
import { useId, useRef, useState } from 'react';
import type { Passage } from '../../../shared/wire';
import { useAnchoredBubble } from '../components/anchored-bubble';

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
  const headingId = useId();
  const questionId = useId();
  useAnchoredBubble(bubble, anchor, onClose);

  // Where focus goes back to: the pill, or the editor it sat in once a later edit removed it.
  const [editor] = useState(() => anchor.closest<HTMLElement>('.ProseMirror'));
  const focusBack = () => (anchor.isConnected ? anchor : editor)?.focus();
  const close = () => {
    focusBack();
    onClose();
  };
  const discuss = () => {
    if (busy || !text.trim()) return;
    focusBack();
    onSend(`${passage.label} — ${text.trim()}`);
  };

  return (
    <div
      ref={bubble}
      className="bubble question-popup"
      role="dialog"
      aria-labelledby={headingId}
      aria-describedby={questionId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div className="bubble-head">
        <h2 id={headingId}>{passage.label}</h2>
        <button type="button" className="bubble-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      <p id={questionId}>{passage.question ?? `See ${passage.label} in the chat.`}</p>
      <div className="bubble-compose">
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
        <button type="button" className="primary" disabled={busy} onClick={discuss}>
          Send
        </button>
      </div>
      {busy && <p className="small muted">Waiting for the AI to finish replying</p>}
    </div>
  );
}
