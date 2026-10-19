// The post dialogs: a new post's title or a post's new one, and the confirm before a delete. The Posts list and the post
// table each mount them.
import { type ReactElement, useEffect, useId, useRef, useState } from 'react';
import type { PostSummary } from '../../../shared/wire';
import { CloseIcon } from '../../components/notice-icons';
import './post-dialogs.css';

// What the dialogs need from the documents hook.
export interface PostDialogsDocs {
  // Every post, as listed, in no order.
  posts: PostSummary[];
  isDirty(id: string): boolean;
  // Makes a post and resolves to its id.
  createPost(title: string): Promise<string>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
}

// What the title box says under it: that another post already has the title, since both would look the same. The post
// being renamed, `self`, does not count.
function duplicateHint(posts: PostSummary[], draft: string, self?: string): string {
  const title = draft.trim();
  return title && posts.some((post) => post.id !== self && post.title.trim() === title)
    ? `You already have a post titled “${title}”. Both will show as “${title}” in the list.`
    : '';
}

// What the title dialog is asking for: a new post's title, or a post's new one. `submit` gets the title as typed.
interface Pending {
  heading: string;
  action: string;
  initial: string;
  // What the box says under it when the title is not a duplicate.
  hint?: string;
  // The post being renamed.
  self?: string;
  submit: (title: string) => Promise<void>;
}

// Why a dialog's last action failed, with a × that closes it and leaves the dialog open.
function DialogError({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <p className="error" role="alert">
      {message}
      <button type="button" className="close" aria-label="Close error" title="Close" onClick={onClose}>
        <CloseIcon />
      </button>
    </p>
  );
}

// `open` is the caller's own wrapper, so a failure to open a new post shows in the caller's alert. `onClose`, when
// given, is called each time either dialog closes, whatever the outcome.
export function usePostDialogs(
  docs: PostDialogsDocs,
  open: (id: string) => void,
  onClose?: () => void,
): { askNewPost(): void; askRename(post: PostSummary): void; askDelete(post: PostSummary): void; dialogs: ReactElement } {
  const [pending, setPending] = useState<Pending>();
  const [draft, setDraft] = useState('');
  const [dialogError, setDialogError] = useState<string>();
  // Whether the dialog's submit is waiting on the server.
  const [submitting, setSubmitting] = useState(false);
  const titleDialog = useRef<HTMLDialogElement>(null);
  // The post a delete is asking about.
  const [deleting, setDeleting] = useState<PostSummary>();
  const deleteDialog = useRef<HTMLDialogElement>(null);
  // The list and the table each mount these dialogs, so their ids are made per caller.
  const titleHeading = useId();
  const titleHint = useId();
  const deleteHeading = useId();
  useEffect(() => {
    const dialog = deleteDialog.current!;
    if (deleting && !dialog.open) dialog.showModal();
    if (!deleting && dialog.open) dialog.close();
  }, [deleting]);
  // The dialog is open exactly while something is pending.
  useEffect(() => {
    const dialog = titleDialog.current!;
    if (pending && !dialog.open) dialog.showModal();
    if (!pending && dialog.open) dialog.close();
  }, [pending]);
  const ask = (next: Pending) => {
    setDraft(next.initial);
    setDialogError(undefined);
    setSubmitting(false);
    setPending(next);
  };
  const askNewPost = () =>
    ask({
      heading: 'New post',
      action: 'Create',
      initial: '',
      submit: async (title) => {
        open(await docs.createPost(title));
      },
    });
  const askRename = (post: PostSummary) =>
    ask({
      heading: `Rename “${post.title}”`,
      action: 'Rename',
      initial: post.title,
      self: post.id,
      hint: 'Only the name in the list changes. The post’s text, including any heading at the top, stays as it is.',
      submit: (title) => docs.rename(post.id, title),
    });
  const askDelete = (post: PostSummary) => {
    setDialogError(undefined);
    setDeleting(post);
  };

  const dialogs = (
    <>
      <dialog
        ref={titleDialog}
        className="name"
        aria-labelledby={titleHeading}
        onClose={() => {
          setPending(undefined);
          onClose?.();
        }}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(e) => e.target === titleDialog.current && titleDialog.current.close()}
      >
        {pending && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitting(true);
              pending.submit(draft).then(
                () => setPending(undefined),
                (error: Error) => {
                  setSubmitting(false);
                  setDialogError(error.message);
                },
              );
            }}
          >
            <h3 id={titleHeading}>{pending.heading}</h3>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Title" aria-describedby={titleHint} autoFocus />
            <p className="name-hint" id={titleHint}>
              {duplicateHint(docs.posts, draft, pending.self) || pending.hint}
            </p>
            {dialogError && <DialogError message={dialogError} onClose={() => setDialogError(undefined)} />}
            <div className="actions">
              <button type="button" onClick={() => setPending(undefined)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={draft.trim() === '' || draft === pending.initial || submitting} aria-busy={submitting}>
                {pending.action}
                {submitting && <span className="spinner" aria-hidden="true" />}
              </button>
            </div>
          </form>
        )}
      </dialog>
      <dialog
        ref={deleteDialog}
        className="confirm"
        aria-labelledby={deleteHeading}
        onClose={() => {
          setDeleting(undefined);
          onClose?.();
        }}
        onClick={(e) => e.target === deleteDialog.current && deleteDialog.current.close()}
      >
        {deleting && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              docs.remove(deleting.id).then(
                () => setDeleting(undefined),
                (error: Error) => setDialogError(error.message),
              );
            }}
          >
            <h3 id={deleteHeading}>Delete “{deleting.title}”?</h3>
            <p>This deletes the post’s folder on disk, with any other files in it, such as notes or outlines. You can’t undo this.</p>
            {docs.isDirty(deleting.id) && <p>Your unsaved changes to it will be lost too.</p>}
            {dialogError && <DialogError message={dialogError} onClose={() => setDialogError(undefined)} />}
            <div className="actions">
              <button type="button" onClick={() => setDeleting(undefined)} autoFocus>
                Cancel
              </button>
              <button type="submit" className="danger">
                Delete
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
  return { askNewPost, askRename, askDelete, dialogs };
}
