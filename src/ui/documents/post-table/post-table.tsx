// The landing page: every post in a table, by title, with a search over titles and saved text.
import { type ReactElement, useEffect, useId, useRef, useState } from 'react';
import type { PostSummary } from '../../../shared/wire';
import { Menu, type Item } from '../../components/menu/menu';
import { CloseIcon, ErrorIcon } from '../../components/notice-icons';
import { usePostDialogs, type PostDialogsDocs } from '../post-dialogs/post-dialogs';
import './post-table.css';

// What the table needs from the documents hook.
export interface PostTableDocs extends PostDialogsDocs {
  open(id: string): Promise<void>;
  // The ids of the posts whose title or saved text holds the query.
  search(query: string): Promise<string[]>;
  // Asks the sidebar to open its New post dialog, as the old empty state did.
  requestNewPost(): void;
}

// By title, then by id, so posts that share a title keep one order. The Posts list sorts the same way.
const byTitle = (a: PostSummary, b: PostSummary) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Why something the table did failed, with a × that closes it.
function ErrorNotice({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="notice error" role="alert">
      <ErrorIcon />
      <span className="notice-text">{message}</span>
      <button className="close" aria-label="Close error" title="Close" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}

// `onOpened` is called after a title click or Edit has opened a post. `focusSearch` puts focus in the search box when
// the table first shows.
export function PostTable({
  docs,
  busy,
  onOpened,
  focusSearch = false,
}: {
  docs: PostTableDocs;
  busy: boolean;
  onOpened: () => void;
  focusSearch?: boolean;
}): ReactElement {
  const heading = useId();
  const searchHint = useId();
  const [query, setQuery] = useState('');
  const needle = query.trim();
  // The ids the latest search answered, or undefined to show every post.
  const [matches, setMatches] = useState<Set<string>>();
  // Why the last search failed, until one succeeds.
  const [searchError, setSearchError] = useState<string>();
  // Counts searches, so only the latest one started is applied: an older answer arriving last is not.
  const searches = useRef(0);
  // Searches once typing stops, and again when the list changes. Until the answer comes, the last one stays.
  useEffect(() => {
    const call = ++searches.current;
    if (!needle) {
      setMatches(undefined);
      return;
    }
    const wait = setTimeout(() => {
      docs.search(needle).then(
        (ids) => {
          if (call !== searches.current) return;
          setSearchError(undefined);
          setMatches(new Set(ids));
        },
        (error: Error) => call === searches.current && setSearchError(`Could not search your posts: ${error.message}`),
      );
    }, 200);
    return () => clearTimeout(wait);
  }, [needle, docs.posts]);
  // Why the last open failed, until one succeeds.
  const [alert, setAlert] = useState<string>();
  const open = (id: string) =>
    docs.open(id).then(
      () => {
        setAlert(undefined);
        onOpened();
      },
      (error: Error) => setAlert(error.message),
    );
  // Where focus goes when a Rename or Delete dialog closes, since the row it came from may be gone.
  const searchInput = useRef<HTMLInputElement>(null);
  const { askRename, askDelete, dialogs } = usePostDialogs(docs, open, () => searchInput.current?.focus());
  // The open "…" menu, by the id of the post whose row opened it, and the button that opened it.
  const [menu, setMenu] = useState<{ at: string; opener: HTMLElement }>();
  // A menu opened on the last rows hangs below the table's visible edge, so it scrolls into view when it opens.
  const menuBox = useRef<HTMLDivElement>(null);
  // A block body: Chrome's scrollIntoView answers a promise, which React would take for a clean-up.
  useEffect(() => {
    menuBox.current?.querySelector('.menu')?.scrollIntoView({ block: 'nearest' });
  }, [menu]);
  // Changing posts waits while the AI works, so the ids its edits come back under stay current. An open menu closes, and
  // focus goes to its row's title, which still opens the post.
  useEffect(() => {
    if (!busy || !menu) return;
    menu.opener.closest('tr')?.querySelector<HTMLButtonElement>('button.title')?.focus();
    setMenu(undefined);
  }, [busy]);
  // The "…" menu of a post.
  const actions = (post: PostSummary): Item[] => [
    { label: 'Edit', icon: 'edit', run: () => open(post.id) },
    { label: 'Rename', icon: 'rename', run: () => askRename(post) },
    { label: 'Delete', icon: 'delete', run: () => askDelete(post) },
  ];
  const [ascending, setAscending] = useState(true);
  const rows = docs.posts.filter((post) => !matches || matches.has(post.id)).sort((a, b) => (ascending ? byTitle(a, b) : -byTitle(a, b)));
  return (
    <div className="post-table">
      <h2 id={heading}>Your posts</h2>
      {alert && <ErrorNotice message={alert} onClose={() => setAlert(undefined)} />}
      <div className="table-tools">
        <div className="search">
          <input ref={searchInput} autoFocus={focusSearch} type="search" aria-label="Search posts" placeholder="Search posts" aria-describedby={searchHint} value={query} onChange={(e) => setQuery(e.target.value)} />
          <p id={searchHint}>Searches titles and saved text.</p>
        </div>
        {/* While paused, the Posts list's status line says why. */}
        <button className="primary" disabled={busy} aria-describedby="tree-paused" onClick={docs.requestNewPost}>
          New post
        </button>
      </div>
      {searchError && <ErrorNotice message={searchError} onClose={() => setSearchError(undefined)} />}
      <table aria-labelledby={heading}>
        <thead>
          <tr>
            <th aria-sort={ascending ? 'ascending' : 'descending'}>
              <button className="sort" onClick={() => setAscending(!ascending)}>
                Title <span aria-hidden="true">{ascending ? '▲' : '▼'}</span>
              </button>
            </th>
            <th>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((post) => (
            <tr key={post.id} data-id={post.id}>
              <td>
                <button className="title" onClick={() => open(post.id)}>
                  <span className="visually-hidden">Open </span>
                  {post.title}
                  {docs.isDirty(post.id) && <span className="unsaved"> (unsaved)</span>}
                </button>
              </td>
              <td className="row-actions">
                <button
                  className="more"
                  aria-label={`More actions for “${post.title}”`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.at === post.id}
                  disabled={busy}
                  aria-describedby="tree-paused"
                  onClick={(e) => setMenu(menu?.at === post.id ? undefined : { at: post.id, opener: e.currentTarget })}
                >
                  …
                </button>
                {menu?.at === post.id && (
                  // Escape puts focus back on the "…", and focus leaving the menu closes it.
                  <div
                    ref={menuBox}
                    onKeyDown={(e) => e.key === 'Escape' && menu.opener.focus()}
                    onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(undefined)}
                  >
                    <Menu items={actions(post)} opener={menu.opener} onClose={() => setMenu(undefined)} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Always in the page, so screen readers hear it when a search finds nothing. */}
      <p className="status" role="status">
        {rows.length === 0 && (needle && matches ? `No posts match “${needle}”.` : docs.posts.length === 0 ? 'No posts yet.' : '')}
      </p>
      {dialogs}
    </div>
  );
}
