// The post panel: the post open in the editor, with its outline and research documents beneath it, and the open
// documents whose unsaved changes have nowhere to be saved. Choosing another post is the post table's job.
import { useEffect, useState } from 'react';
import { documentKey, parseDocumentKey, postOfKey } from '../../../shared/document-key';
import type { PostDocuments } from '../../../shared/wire';
import { ConfirmDialog } from '../../components/confirm-dialog/confirm-dialog';
import { Menu, type Item } from '../../components/menu/menu';
import { CloseIcon, ErrorIcon } from '../../components/notice-icons';
import { usePostDialogs, type PostDialogsDocs } from '../components/post-dialogs/post-dialogs';
import './post-panel.css';

// What the panel needs from the documents hook. Documents are named by document key.
export interface PostPanelDocs extends PostDialogsDocs {
  current?: string;
  // The open post's outline and research documents, once listed.
  postDocs?: { postId: string } & PostDocuments;
  // Open documents with unsaved changes whose post, or research document, the store no longer has.
  missing: string[];
  // A document's name for the writer.
  label(key: string): string;
  // Whether the latest post list holds the post.
  isListed(postId: string): boolean;
  isDirty(key: string): boolean;
  open(key: string): Promise<void>;
  // Deletes a research document for good.
  removeDocument(key: string): Promise<void>;
}

export function PostPanel({ docs, busy }: { docs: PostPanelDocs; busy: boolean }) {
  // The open "…" menu, by the key of the document whose row opened it, and the button that opened it.
  const [menu, setMenu] = useState<{ at: string; opener: HTMLElement }>();
  // Why the last open or research delete failed, until one succeeds or it is closed.
  const [alert, setAlert] = useState<string>();
  const open = (key: string) =>
    docs.open(key).then(
      () => setAlert(undefined),
      (error: Error) => setAlert(error.message),
    );
  const { askRename, askDelete, dialogs } = usePostDialogs(docs, open, { busy });
  // The research document a delete is asking about.
  const [deleting, setDeleting] = useState<string>();
  // Renaming and deleting wait while the AI works, so the keys its edits come back under stay current. An open menu
  // closes, and focus goes to its row's name, which still opens the document.
  useEffect(() => {
    if (!busy || !menu) return;
    menu.opener.closest('.row')?.querySelector<HTMLButtonElement>('button.name')?.focus();
    setMenu(undefined);
  }, [busy]);

  const postId = postOfKey(docs.current ?? '');
  const listed = postId !== undefined && docs.isListed(postId);
  const shown = docs.postDocs?.postId === postId ? docs.postDocs : undefined;
  const outlineKey = postId === undefined ? undefined : documentKey({ kind: 'outline', postId });
  const hasOutline = outlineKey !== undefined && (shown?.outline || docs.isDirty(outlineKey) || docs.current === outlineKey);
  const research = [...(shown?.researchDocuments ?? [])].sort((a, b) => a.title.localeCompare(b.title));

  // A document's name button: it opens the document, and is marked while the document is on show.
  const name = (key: string, text: string, suffix?: string) => (
    <button className="name" aria-current={docs.current === key ? 'true' : undefined} onClick={() => open(key)}>
      {text}
      {suffix ? <span className="unsaved">{suffix}</span> : docs.isDirty(key) && <span className="unsaved"> (unsaved)</span>}
    </button>
  );
  // A row's "…" and its menu, after the row's name so Tab reaches it.
  const actions = (key: string, title: string, items: Item[]) => (
    <div className="row-actions">
      <button
        className="more"
        aria-label={`Actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={menu?.at === key}
        disabled={busy}
        aria-describedby="tree-paused"
        onClick={(e) => setMenu(menu?.at === key ? undefined : { at: key, opener: e.currentTarget })}
      >
        …
      </button>
      {menu?.at === key && !busy && <Menu items={items} opener={menu.opener} onClose={() => setMenu(undefined)} />}
    </div>
  );
  const active = (key: string) => (docs.current === key ? 'active' : '');
  // Where a document with nowhere to be saved belongs, said after its name.
  const goneSuffix = (key: string) => {
    const ref = parseDocumentKey(key);
    return ref?.kind === 'research' && docs.isListed(ref.postId) ? ' — unsaved, no longer in its post' : ' — unsaved, not in your posts';
  };
  // The open post heads the panel when it is gone, so it is not listed again below.
  const missing = docs.missing.filter((key) => listed || key !== postId);

  return (
    <aside className="files post-panel" aria-label="Post Content">
      <div className="files-head">
        <h2>Post Content</h2>
      </div>
      <div className="files-body">
        {alert && (
          <div className="notice error" role="alert">
            <ErrorIcon />
            <span className="notice-text">{alert}</span>
            <button className="close" aria-label="Close error" title="Close" onClick={() => setAlert(undefined)}>
              <CloseIcon />
            </button>
          </div>
        )}
        {postId === undefined ? (
          <p className="hint">No post open. Pick one from your posts.</p>
        ) : (
          <>
            <div className={`row post ${active(postId)}`}>
              <h3>{listed ? name(postId, 'Draft') : name(postId, docs.label(postId), goneSuffix(postId))}</h3>
              {listed &&
                actions(postId, docs.label(postId), [
                  { label: 'Rename', icon: 'rename', run: () => askRename({ id: postId, title: docs.label(postId) }) },
                  { label: 'Delete', icon: 'delete', run: () => askDelete({ id: postId, title: docs.label(postId) }) },
                ])}
            </div>
            {listed && !hasOutline && research.length === 0 && <p className="hint">Research and an outline for this post appear here.</p>}
            <ul className="tree" aria-label="This post’s documents">
              {hasOutline && <li className={`row ${active(outlineKey!)}`}>{name(outlineKey!, 'Draft Outline')}</li>}
            </ul>
            {research.length > 0 && (
              <>
                <h4>Research</h4>
                <ul className="tree" aria-label="Research">
                  {research.map(({ id, title }) => {
                    const key = documentKey({ kind: 'research', postId, researchDocumentId: id });
                    return (
                      <li key={id} className={`row ${active(key)}`}>
                        {name(key, title)}
                        {actions(key, title, [{ label: 'Delete', icon: 'delete', run: () => setDeleting(key) }])}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}
        {missing.length > 0 && (
          <ul className="tree" aria-label="Unsaved, with nowhere to save">
            {missing.map((key) => (
              <li key={key} className={`row missing ${active(key)}`}>
                {name(key, docs.label(key), goneSuffix(key))}
              </li>
            ))}
          </ul>
        )}
        {/* Always in the page, in every state, so screen readers hear it fill when Claude starts working. */}
        <p className="paused" role="status" id="tree-paused">
          {busy && 'Renaming and deleting are paused while Claude works. You can still open, edit, and save.'}
        </p>
      </div>
      {dialogs}
      {deleting !== undefined && (
        <ConfirmDialog
          title={`Delete “${docs.label(deleting)}”?`}
          body={`You can’t undo this.${docs.isDirty(deleting) ? ' Your unsaved changes to it will be lost too.' : ''}`}
          confirm="Delete"
          onConfirm={() => {
            const key = deleting;
            setDeleting(undefined);
            docs.removeDocument(key).then(
              () => setAlert(undefined),
              (error: Error) => setAlert(error.message),
            );
          }}
          onCancel={() => setDeleting(undefined)}
        />
      )}
    </aside>
  );
}
