// The post list: every post by title, flat, with the open posts that are not in it.
import { useEffect, useRef, useState } from 'react';
import type { PostSummary } from '../../../shared/wire';
import { Menu, type Item } from '../../components/menu/menu';
import { CloseIcon, ErrorIcon } from '../../components/notice-icons';
import { usePostDialogs, type PostDialogsDocs } from '../post-dialogs/post-dialogs';
import './post-list.css';

// What the list needs from the documents hook.
export interface PostListDocs extends PostDialogsDocs {
  // Open posts with unsaved changes whose id is not listed.
  missing: string[];
  current?: string;
  // Each rises when the page asks the list to show the open post, or to ask for a new post.
  finds: number;
  newPosts: number;
  // A post's name for the writer: its title, or its id when it is not listed.
  label(id: string): string;
  open(id: string): Promise<void>;
}

// By title, then by id, so posts that share a title keep one order.
const byTitle = (a: PostSummary, b: PostSummary) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function PostList({ docs, busy }: { docs: PostListDocs; busy: boolean }) {
  // The open "…" menu, by the id of the post whose row opened it, and the button that opened it. Changing the list
  // waits while the AI works, so the ids its edits come back under stay current.
  const [openMenu, setMenu] = useState<{ at: string; opener: HTMLElement }>();
  const menu = busy ? undefined : openMenu;
  // Why the last open failed, until one succeeds.
  const [alert, setAlert] = useState<string>();
  const open = (id: string) =>
    docs.open(id).then(
      () => setAlert(undefined),
      (error: Error) => setAlert(error.message),
    );
  const { askNewPost, askRename, askDelete, dialogs } = usePostDialogs(docs, open);

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
    { label: 'Rename', icon: 'rename', run: () => askRename(post) },
    { label: 'Delete', icon: 'delete', run: () => askDelete(post) },
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
      {dialogs}
    </aside>
  );
}
