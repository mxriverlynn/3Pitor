// The speech bubble the button beside a selection opens: the selected text, and a box to ask the AI about it.
// It knows only the selection; the page decides when it is open and what sending does.
import { useId, useRef, useState } from 'react';
import { useAnchoredBubble } from './anchored-bubble';
import './selection-popup.css';

// The chat message asking about `markdown`: the selection as a quote, then the writer's words.
export function selectionMessage(markdown: string, text: string): string {
  const quote = markdown
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
  return `About this passage:\n\n${quote}\n\n${text.trim()}`;
}

export function SelectionPopup({
  markdown,
  anchor,
  busy,
  onSend,
  onClose,
}: {
  // The selection, as markdown.
  markdown: string;
  // The button the writer clicked.
  anchor: HTMLElement;
  // A turn is running, so nothing can be sent yet.
  busy: boolean;
  // Sends the writer's message, the selection quoted first.
  onSend: (message: string) => void;
  onClose: () => void;
}) {
  const bubble = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [text, setText] = useState('');
  useAnchoredBubble(bubble, anchor, onClose);

  // Focus goes back to the editor the button sits beside, which shows the selection again.
  const [editor] = useState(() => anchor.parentElement?.querySelector<HTMLElement>('.ProseMirror') ?? null);
  const close = () => {
    editor?.focus();
    onClose();
  };
  const send = () => {
    if (busy || !text.trim()) return;
    editor?.focus();
    onSend(selectionMessage(markdown, text));
  };

  return (
    <div
      ref={bubble}
      className="bubble selection-popup"
      role="dialog"
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div className="bubble-head">
        <h2 id={headingId}>Ask about the selection</h2>
        <button type="button" className="bubble-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      <blockquote className="selection-popup-quote">{markdown}</blockquote>
      <div className="bubble-compose">
        <textarea
          autoFocus
          rows={2}
          aria-label="Ask about the selection"
          placeholder="Ask the AI about this…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter mid-composition picks an input method's candidate; it is not a send.
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            send();
          }}
        />
        <button type="button" className="primary" disabled={busy} onClick={send}>
          Send
        </button>
      </div>
      {busy && <p className="small muted">Waiting for the AI to finish replying</p>}
    </div>
  );
}
