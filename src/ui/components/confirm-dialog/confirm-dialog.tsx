// A question the writer must answer before something that cannot be taken back. A native modal dialog, so focus stays
// in it and Escape cancels. Focus starts on Cancel; the caller decides where it goes after either answer.
import { useEffect, useId, useRef } from 'react';
import './confirm-dialog.css';

export function ConfirmDialog({
  title,
  body,
  confirm,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  // The confirm button's text.
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!dialog.current!.open) dialog.current!.showModal();
    cancel.current!.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h3 id={`${id}-title`}>{title}</h3>
      <p id={`${id}-body`}>{body}</p>
      <div className="actions">
        <button type="button" ref={cancel} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
