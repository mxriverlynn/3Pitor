// The speech bubble the link button opens beside the selected text: where the link goes, and its title.
// It knows only the link; the editor decides what the link goes on.
import { useId, useRef, useState } from 'react';
import { useAnchoredBubble } from '../components/anchored-bubble';
import './link-popup.css';

// Addresses that run a script when followed, which the markdown would not keep as a link anyway.
const SCRIPT = /^\s*(?:javascript|vbscript|data):/i;

export function LinkPopup({
  anchor,
  title: initialTitle = '',
  onLink,
  onClose,
}: {
  // The selected text the link goes on.
  anchor: HTMLElement;
  // What the title starts as.
  title?: string;
  // Links the selected text.
  onLink: (link: { href: string; title: string }) => void;
  onClose: () => void;
}) {
  const bubble = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [href, setHref] = useState('');
  const [title, setTitle] = useState(initialTitle);
  useAnchoredBubble(bubble, anchor, onClose);

  // Focus goes back to the editor the anchor sits beside, which shows the selection again. Pressing elsewhere in the
  // page closes the popup without it, leaving focus where the writer pressed.
  const [editor] = useState(() => anchor.parentElement?.querySelector<HTMLElement>('.ProseMirror') ?? null);
  const close = () => {
    editor?.focus();
    onClose();
  };
  // Set when the writer tried to link to an address that runs a script.
  const [refused, setRefused] = useState(false);
  const link = () => {
    if (!href.trim()) return;
    if (SCRIPT.test(href)) return setRefused(true);
    editor?.focus();
    onLink({ href: href.trim(), title: title.trim() });
  };

  return (
    <div
      ref={bubble}
      className="bubble link-popup"
      role="dialog"
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') return close();
        // Enter mid-composition picks an input method's candidate; it is not a submit.
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
        e.preventDefault();
        link();
      }}
    >
      <div className="bubble-head">
        <h2 id={headingId}>Add a link</h2>
        <button type="button" className="bubble-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      <label className="link-popup-field">
        Link target
        <input autoFocus type="text" placeholder="https://…" value={href} onChange={(e) => setHref(e.target.value)} />
      </label>
      <label className="link-popup-field">
        Title
        <input type="text" placeholder="Optional" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {refused && (
        <p role="alert" className="link-popup-refused">
          A link can’t run a script. Use a web address instead.
        </p>
      )}
      <button type="button" className="primary link-popup-add" onClick={link}>
        Add link
      </button>
    </div>
  );
}
