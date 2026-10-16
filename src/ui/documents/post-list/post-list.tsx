// The post list: every post by title, flat, with the open posts that are not in it.
import { useEffect, useRef, useState } from 'react';
import type { PostSummary } from '../../../shared/wire';
import { Menu, type Item } from '../../components/menu/menu';
import { CloseIcon, ErrorIcon } from '../../components/notice-icons';
import './post-list.css';

// What the list needs from the documents hook.
export interface PostListDocs {
  // Every post, as listed, in no order.
  posts: PostSummary[];
  // Open posts with unsaved changes whose id is not listed.
  missing: string[];
  current?: string;
  // Each rises when the page asks the list to show the open post, or to ask for a new post.
  finds: number;
  newPosts: number;
  // A post's name for the writer: its title, or its id when it is not listed.
  label(id: string): string;
  isDirty(id: string): boolean;
  open(id: string): Promise<void>;
  // Makes a post and resolves to its id.
  createPost(title: string): Promise<string>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
}

// By title, then by id, so posts that share a title keep one order.
const byTitle = (a: PostSummary, b: PostSummary) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

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

export function PostList({ docs, busy }: { docs: PostListDocs; busy: boolean }) {
  // The open "…" menu, by the id of the post whose row opened it, and the button that opened it. Changing the list
  // waits while the AI works, so the ids its edits come back under stay current.
  const [openMenu, setMenu] = useState<{ at: string; opener: HTMLElement }>();
  const menu = busy ? undefined : openMenu;
  const [pending, setPending] = useState<Pending>();
  const [draft, setDraft] = useState('');
  const [dialogError, setDialogError] = useState<string>();
  // Whether the dialog's submit is waiting on the server.
  const [submitting, setSubmitting] = useState(false);
  const titleDialog = useRef<HTMLDialogElement>(null);
  // The post a delete is asking about.
  const [deleting, setDeleting] = useState<PostSummary>();
  const deleteDialog = useRef<HTMLDialogElement>(null);
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
  // Why the last open failed, until one succeeds.
  const [alert, setAlert] = useState<string>();
  const open = (id: string) =>
    docs.open(id).then(
      () => setAlert(undefined),
      (error: Error) => setAlert(error.message),
    );
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

  // New post in the empty editor asks for a new post's title, unless Claude is working.
  useEffect(() => {
    if (docs.newPosts && !busy) askNewPost();
  }, [docs.newPosts]);
  // Show in the post list scrolls the open post's row into view.
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (docs.finds) list.current?.querySelector('.row.active > button.name')?.scrollIntoView({ block: 'nearest' });
  }, [docs.finds]);

  // The "…" menu of a listed post.
  const actions = (post: PostSummary): Item[] => [
    {
      label: 'Rename',
      icon: 'rename',
      run: () =>
        ask({
          heading: `Rename “${post.title}”`,
          action: 'Rename',
          initial: post.title,
          self: post.id,
          hint: 'Only the name in the list changes. The post’s text, including any heading at the top, stays as it is.',
          submit: (title) => docs.rename(post.id, title),
        }),
    },
    {
      label: 'Delete',
      icon: 'delete',
      run: () => {
        setDialogError(undefined);
        setDeleting(post);
      },
    },
  ];

  return (
    <aside className="files">
      <div className="files-head">
        <h1>3pitor</h1>
        <button className="add" aria-label="New post" title="New post" disabled={busy} onClick={askNewPost}>
          +
        </button>
      </div>
      <h2>Posts</h2>
      {alert && (
        <div className="notice error" role="alert">
          <ErrorIcon />
          <span className="notice-text">{alert}</span>
          <button className="close" aria-label="Close error" title="Close" onClick={() => setAlert(undefined)}>
            <CloseIcon />
          </button>
        </div>
      )}
      <ul className="tree" aria-label="Posts" ref={list}>
        {[...docs.posts].sort(byTitle).map((post) => (
          <li key={post.id} className={`row ${post.id === docs.current ? 'active' : ''}`}>
            <div className="row-actions">
              <button
                className="more"
                aria-label={`Actions for ${post.title}`}
                aria-haspopup="menu"
                aria-expanded={menu?.at === post.id}
                disabled={busy}
                onClick={(e) => setMenu(menu?.at === post.id ? undefined : { at: post.id, opener: e.currentTarget })}
              >
                …
              </button>
              {menu?.at === post.id && <Menu items={actions(post)} opener={menu.opener} onClose={() => setMenu(undefined)} />}
            </div>
            <button className="name" onClick={() => open(post.id)}>
              {post.title}
              {docs.isDirty(post.id) && <span className="unsaved"> (unsaved)</span>}
            </button>
          </li>
        ))}
        {docs.missing.map((id) => (
          <li key={id} className={`row missing ${id === docs.current ? 'active' : ''}`}>
            <button className="name" onClick={() => open(id)}>
              {docs.label(id)}
              <span className="unsaved"> — unsaved, not in your posts</span>
            </button>
          </li>
        ))}
      </ul>
      {/* Always in the page, so screen readers hear it fill when Claude starts working. */}
      <p className="paused" role="status" id="tree-paused">
        {busy && 'Changes to the post list are paused while Claude works. You can still open posts.'}
      </p>
      <dialog
        ref={titleDialog}
        className="name"
        aria-labelledby="title-dialog-heading"
        onClose={() => setPending(undefined)}
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
            <h3 id="title-dialog-heading">{pending.heading}</h3>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Title" aria-describedby="title-hint" autoFocus />
            <p className="name-hint" id="title-hint">
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
        aria-labelledby="delete-dialog-heading"
        onClose={() => setDeleting(undefined)}
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
            <h3 id="delete-dialog-heading">Delete “{deleting.title}”?</h3>
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
    </aside>
  );
}
