// The speech bubble Insert ▸ Image opens beside the caret: where the image is, what it shows, and its hover text.
// It knows only the image; the editor decides where the image goes.
import { useId, useRef, useState } from 'react';
import { useAnchoredBubble } from './anchored-bubble';
import { SCRIPT } from './link-popup';
import './image-popup.css';

// An image as the writer describes it.
export type Image = { src: string; alt: string; title: string };

export function ImagePopup({
  anchor,
  image = { src: '', alt: '', title: '' },
  editing = false,
  replacesSelection = false,
  onInsert,
  onClose,
}: {
  // Where the image goes: the caret, the selected text, or the image being changed.
  anchor: HTMLElement;
  // What the fields start as.
  image?: Image;
  // The image is one already in the post, which the popup changes.
  editing?: boolean;
  // The image goes in place of selected text.
  replacesSelection?: boolean;
  // Puts the image in.
  onInsert: (image: Image) => void;
  onClose: () => void;
}) {
  const bubble = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [src, setSrc] = useState(image.src);
  const [alt, setAlt] = useState(image.alt);
  const [title, setTitle] = useState(image.title);
  // What is wrong with the address, once the writer has tried to put the image in.
  const [error, setError] = useState<string>();
  useAnchoredBubble(bubble, anchor, onClose);

  // Focus goes back to the editor the anchor sits beside, where the writer was. Pressing elsewhere in the page closes
  // the popup without it, leaving focus where the writer pressed.
  const [editor] = useState(() => anchor.parentElement?.querySelector<HTMLElement>('.ProseMirror') ?? null);
  const close = () => {
    editor?.focus();
    onClose();
  };
  const insert = () => {
    if (!src.trim()) return setError('Add the image’s address.');
    if (SCRIPT.test(src)) return setError('An image address can’t run a script or hold the image itself. Paste a web address instead.');
    editor?.focus();
    onInsert({ src: src.trim(), alt: alt.trim(), title: title.trim() });
  };

  return (
    <div
      ref={bubble}
      className="bubble image-popup"
      role="dialog"
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') return close();
        // Enter mid-composition picks an input method's candidate; it is not a submit.
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
        e.preventDefault();
        insert();
      }}
    >
      <div className="bubble-head">
        <h2 id={headingId}>{editing ? 'Edit image' : 'Add an image'}</h2>
        <button type="button" className="bubble-close" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      <label className="popup-field">
        Image address
        <input
          autoFocus
          type="text"
          inputMode="url"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          placeholder="https://…"
          value={src}
          aria-invalid={!!error}
          aria-describedby={`${headingId}-src-hint${error ? ` ${headingId}-error` : ''}`}
          onChange={(e) => {
            setSrc(e.target.value);
            setError(undefined);
          }}
        />
      </label>
      <p id={`${headingId}-src-hint`} className="popup-hint">
        Paste a web address for the image.
      </p>
      {error && (
        <p id={`${headingId}-error`} role="alert" className="popup-error">
          {error}
        </p>
      )}
      <label className="popup-field">
        Description
        <input
          type="text"
          placeholder="What the image shows"
          value={alt}
          aria-describedby={`${headingId}-alt-hint`}
          onChange={(e) => setAlt(e.target.value)}
        />
      </label>
      <p id={`${headingId}-alt-hint`} className="popup-hint">
        Read aloud to people who can’t see the image. Leave it empty if the image is only decoration.
      </p>
      <label className="popup-field">
        Hover text
        <input type="text" placeholder="Optional" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {replacesSelection && <p className="popup-hint">Replaces the selected text.</p>}
      <button type="button" className="primary popup-submit" onClick={insert}>
        {editing ? 'Save image' : 'Add image'}
      </button>
    </div>
  );
}
