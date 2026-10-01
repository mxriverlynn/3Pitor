// The document list: the workspace's folders and markdown files as a tree that expands folder by folder.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentEntry, FolderCount } from '../../../shared/wire';
import { Menu, type Item } from '../../components/menu/menu';
import { movedPath, within } from '../components/paths';
import type { Documents } from '../documents/documents';
import { newEntryName } from './entry-name';
import './file-tree.css';

// One row of the tree, with the rows inside it when it is a folder.
type TreeNode = DocumentEntry & { onDisk: boolean; children: TreeNode[] };

// Nests `listed` by path. Inside each folder, folders come first, then files, each sorted with `<`.
function nest(listed: Documents['listed']): TreeNode[] {
  const roots: TreeNode[] = [];
  const folders = new Map<string, TreeNode>();
  // `listed` is sorted by path, so a folder always comes before what is inside it.
  for (const entry of listed) {
    const node: TreeNode = { ...entry, children: [] };
    if (entry.kind === 'folder') folders.set(entry.path, node);
    const slash = entry.path.lastIndexOf('/');
    (slash < 0 ? roots : folders.get(entry.path.slice(0, slash))!.children).push(node);
  }
  const order = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.path < b.path ? -1 : 1));
    for (const node of nodes) order(node.children);
  };
  order(roots);
  return roots;
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
// The folder holding `path`, '' for the top level.
const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
// Where `path` lands when moved into `folder` ('' for the top level).
const into = (folder: string, path: string) => (folder ? `${folder}/${basename(path)}` : basename(path));

// The icon before a row's name: a document for a file, a folder that shows whether it is open. Decorative; the
// button's name and aria-expanded already say what the row is.
function EntryIcon({ kind, open }: { kind: 'file' | 'folder'; open?: boolean }) {
  const className = kind === 'file' ? 'icon file' : `icon folder${open ? ' open' : ''}`;
  return (
    <svg className={className} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {kind === 'file' ? (
        <path d="M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5v3.5h3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      ) : open ? (
        <path d="M1.5 13.5v-10h4.5l1.5 1.5h5v2 M1.5 13.5l2-6h11l-2 6z" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      ) : (
        <path d="M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      )}
    </svg>
  );
}

// What the dialogs are asking: a name for a new file, a new folder, or a rename; or whether to delete an item. A
// folder's delete waits for `count`. A name's `clean` turns the draft into the name `submit` gets, "" while there is
// none to submit.
type Pending =
  | {
      kind: 'name';
      title: string;
      action: string;
      initial: string;
      clean: (draft: string) => string;
      submit: (name: string) => Promise<void>;
    }
  | { kind: 'move'; path: string }
  | { kind: 'delete'; path: string; folder: boolean; count?: FolderCount; unsaved: string[] };

// "1 file", "3 files".
const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const withMd = (name: string) => (name.endsWith('.md') ? name : `${name}.md`);

export function FileTree({ docs, busy }: { docs: Documents; busy: boolean }) {
  // The open menu, by the path of the row that opened it ('' for "+"), and the button that opened it.
  // Changing the tree waits while the AI works, so the names its edits come back under stay current.
  const [openMenu, setMenu] = useState<{ at: string; opener: HTMLElement }>();
  const menu = busy ? undefined : openMenu;
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const [pending, setPending] = useState<Pending>();
  const [draft, setDraft] = useState('');
  // Why the dialog's last submit failed.
  const [dialogError, setDialogError] = useState<string>();
  const nameDialog = useRef<HTMLDialogElement>(null);
  const moveDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  // Each dialog is open exactly while `pending` asks what it asks.
  useEffect(() => {
    for (const [dialog, kind] of [
      [nameDialog.current!, 'name'],
      [moveDialog.current!, 'move'],
      [deleteDialog.current!, 'delete'],
    ] as const) {
      if (pending?.kind === kind && !dialog.open) dialog.showModal();
      if (pending?.kind !== kind && dialog.open) dialog.close();
    }
  }, [pending]);
  const ask = (next: Extract<Pending, { kind: 'name' }>) => {
    setDraft(next.initial);
    setDialogError(undefined);
    setPending(next);
  };
  // Why the last open failed, until one succeeds.
  const [alert, setAlert] = useState<string>();
  // The folders showing what is inside them. Every folder starts collapsed.
  const [expanded, setExpanded] = useState(new Set<string>());
  const toggle = (path: string) =>
    setExpanded((before) => {
      const after = new Set(before);
      if (!after.delete(path)) after.add(path);
      return after;
    });
  const expand = (path: string) => setExpanded((before) => new Set(before).add(path));
  // Find in docs opens every folder around the file on show, then scrolls its row into view once the tree shows it.
  const tree = useRef<HTMLUListElement>(null);
  const reveal = useRef(false);
  useEffect(() => {
    const file = docs.current;
    if (!docs.finds || file === undefined) return;
    reveal.current = true;
    setExpanded((before) => {
      const after = new Set(before);
      const parts = file.split('/');
      for (let i = 1; i < parts.length; i++) after.add(parts.slice(0, i).join('/'));
      return after;
    });
  }, [docs.finds]);
  useEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    tree.current?.querySelector('.row.active > button.name')?.scrollIntoView({ block: 'nearest' });
  });
  const open = (name: string) =>
    docs.open(name).then(
      () => setAlert(undefined),
      (error: Error) => setAlert(error.message),
    );

  // New file and New folder inside `folder` ('' for the top level).
  const createItems = (folder: string): Item[] => {
    const inside = (name: string) => (folder ? `${folder}/${name}` : name);
    // Showing the new item means showing what is inside its folder.
    const create = async (path: string, kind: 'file' | 'folder') => {
      await docs.createEntry(path, kind);
      if (folder) expand(folder);
    };
    return [
      {
        label: 'New file',
        icon: 'new-file',
        run: () =>
          ask({
            kind: 'name',
            title: 'New file',
            action: 'Create',
            initial: '',
            clean: (draft) => newEntryName(draft, 'file'),
            submit: (name) => create(inside(name), 'file'),
          }),
      },
      {
        label: 'New folder',
        icon: 'new-folder',
        run: () =>
          ask({
            kind: 'name',
            title: 'New folder',
            action: 'Create',
            initial: '',
            clean: (draft) => newEntryName(draft, 'folder'),
            submit: (name) => create(inside(name), 'folder'),
          }),
      },
    ];
  };

  // Moves an item, keeping expanded folders expanded under their new paths.
  const move = async (from: string, to: string) => {
    await docs.move(from, to);
    setExpanded((before) => new Set([...before].map((path) => movedPath(path, from, to) ?? path)));
  };

  // The item being dragged, kept here because browsers hide what a drag carries until it is dropped; and the folder
  // it hovers over that would take it ('' for the top level).
  const [dragged, setDragged] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  // Drop handlers for `folder` ('' for the top level), which takes any on-disk item but itself or a folder around it.
  const dropProps = (folder: string) => {
    const takes = () => !busy && dragged !== undefined && !within(folder, dragged);
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!takes()) return;
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(folder);
      },
      onDragLeave: () => setDropTarget((now) => (now === folder ? undefined : now)),
      onDrop: (e: React.DragEvent) => {
        if (!takes()) return;
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(undefined);
        setDragged(undefined);
        // Dropping an item where it already is does nothing.
        if (parentOf(dragged!) === folder) return;
        move(dragged!, into(folder, dragged!)).then(
          () => setAlert(undefined),
          (error: Error) => setAlert(error.message),
        );
      },
    };
  };

  // The folders `path` can move into ('' for the top level): any on disk but itself, what is inside it, and its parent.
  const destinations = (path: string) =>
    ['', ...docs.listed.filter((e) => e.kind === 'folder' && e.onDisk).map((e) => e.path)].filter(
      (folder) => folder !== parentOf(path) && !within(folder, path),
    );

  // The "..." menu of an on-disk item.
  const actions = ({ path, kind }: TreeNode): Item[] => {
    const parent = path.slice(0, path.lastIndexOf('/') + 1);
    const rename: Item = {
      label: 'Rename',
      icon: 'rename',
      run: () =>
        ask({
          kind: 'name',
          title: `Rename ${basename(path)}`,
          action: 'Rename',
          initial: basename(path),
          clean: (draft) => (draft.includes('/') ? '' : draft.trim()),
          submit: (name) => move(path, parent + (kind === 'file' ? withMd(name) : name)),
        }),
    };
    const moveTo: Item = {
      label: 'Move to…',
      icon: 'move',
      run: () => {
        setDialogError(undefined);
        setPending({ kind: 'move', path });
      },
    };
    const remove: Item = {
      label: 'Delete',
      icon: 'delete',
      run: () => {
        const folder = kind === 'folder';
        setDialogError(undefined);
        setPending({ kind: 'delete', path, folder, unsaved: docs.dirtyWithin(path) });
        if (folder)
          docs.countContents(path).then(
            (count) => setPending((now) => (now?.kind === 'delete' && now.path === path ? { ...now, count } : now)),
            (error: Error) => setDialogError(error.message),
          );
      },
    };
    return kind === 'folder' ? [...createItems(path), rename, moveTo, remove] : [rename, moveTo, remove];
  };

  const row = (node: TreeNode) => {
    const isFolder = node.kind === 'folder';
    const isOpen = expanded.has(node.path);
    return (
      <li
        key={node.path}
        className={`row ${isFolder ? 'folder' : ''} ${node.path === docs.current ? 'active' : ''} ${dropTarget === node.path ? 'drop' : ''}`}
        draggable={!busy && node.onDisk}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData('text/plain', node.path);
          e.dataTransfer.effectAllowed = 'move';
          setDragged(node.path);
        }}
        onDragEnd={() => {
          setDragged(undefined);
          setDropTarget(undefined);
        }}
        {...(isFolder && node.onDisk ? dropProps(node.path) : {})}
      >
        {node.onDisk && (
          <div className="row-actions">
            <button
              className="more"
              aria-label={`Actions for ${node.path}`}
              aria-haspopup="menu"
              aria-expanded={menu?.at === node.path}
              disabled={busy}
              onClick={(e) => setMenu(menu?.at === node.path ? undefined : { at: node.path, opener: e.currentTarget })}
            >
              …
            </button>
            {menu?.at === node.path && <Menu items={actions(node)} opener={menu.opener} onClose={closeMenu} />}
          </div>
        )}
        <button
          className="name"
          aria-expanded={isFolder ? isOpen : undefined}
          onClick={() => (isFolder ? toggle(node.path) : open(node.path))}
        >
          <EntryIcon kind={node.kind} open={isOpen} />
          {basename(node.path)}
          {docs.isDirty(node.path) && <span className="unsaved"> (unsaved)</span>}
        </button>
        {isFolder && isOpen && <ul>{node.children.map(row)}</ul>}
      </li>
    );
  };

  return (
    <aside className="files">
      <div className="files-head">
        <h2 className={dropTarget === '' ? 'drop' : ''} {...dropProps('')}>
          Documents
        </h2>
        <button
          className="add"
          aria-label="New file or folder"
          title="New file or folder"
          aria-haspopup="menu"
          aria-expanded={menu?.at === ''}
          disabled={busy}
          onClick={(e) => setMenu(menu?.at === '' ? undefined : { at: '', opener: e.currentTarget })}
        >
          +
        </button>
        {menu?.at === '' && <Menu items={createItems('')} opener={menu.opener} onClose={closeMenu} />}
      </div>
      {alert && (
        <div className="notice" role="alert">
          {alert}
        </div>
      )}
      <ul className="tree" aria-label="Documents" ref={tree}>
        {nest(docs.listed).map(row)}
      </ul>
      <dialog
        ref={nameDialog}
        className="name"
        aria-labelledby="name-dialog-title"
        onClose={() => setPending(undefined)}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(e) => e.target === nameDialog.current && nameDialog.current.close()}
      >
        {pending?.kind === 'name' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              pending.submit(pending.clean(draft)).then(
                () => setPending(undefined),
                (error: Error) => setDialogError(error.message),
              );
            }}
          >
            <h3 id="name-dialog-title">{pending.title}</h3>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Name" autoFocus />
            {dialogError && (
              <p className="error" role="alert">
                {dialogError}
              </p>
            )}
            <div className="actions">
              <button type="button" onClick={() => setPending(undefined)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={!pending.clean(draft)}>
                {pending.action}
              </button>
            </div>
          </form>
        )}
      </dialog>
      <dialog
        ref={moveDialog}
        className="move"
        aria-labelledby="move-dialog-title"
        onClose={() => setPending(undefined)}
        onClick={(e) => e.target === moveDialog.current && moveDialog.current.close()}
      >
        {pending?.kind === 'move' && (
          <>
            <h3 id="move-dialog-title">Move {pending.path} to…</h3>
            <div className="destinations">
              {destinations(pending.path).map((folder) => (
                <button
                  key={folder}
                  onClick={() =>
                    move(pending.path, into(folder, pending.path)).then(
                      () => setPending(undefined),
                      (error: Error) => setDialogError(error.message),
                    )
                  }
                >
                  {folder || 'Documents (top level)'}
                </button>
              ))}
            </div>
            {dialogError && (
              <p className="error" role="alert">
                {dialogError}
              </p>
            )}
            <div className="actions">
              <button type="button" onClick={() => setPending(undefined)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </dialog>
      <dialog
        ref={deleteDialog}
        className="confirm"
        aria-labelledby="delete-dialog-title"
        onClose={() => setPending(undefined)}
        onClick={(e) => e.target === deleteDialog.current && deleteDialog.current.close()}
      >
        {pending?.kind === 'delete' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              docs.remove(pending.path).then(
                () => setPending(undefined),
                (error: Error) => setDialogError(error.message),
              );
            }}
          >
            <h3 id="delete-dialog-title">
              {!pending.folder
                ? `Delete ${pending.path}?`
                : pending.count
                  ? `Delete ${pending.path} and everything in it: ${counted(pending.count.files, 'file', 'files')} and ${counted(pending.count.folders, 'sub-folder', 'sub-folders')}?`
                  : `Delete ${pending.path} and everything in it?`}
            </h3>
            {pending.unsaved.length > 0 && <p>Unsaved changes in {pending.unsaved.join(', ')} will be lost.</p>}
            {dialogError && (
              <p className="error" role="alert">
                {dialogError}
              </p>
            )}
            <div className="actions">
              <button type="button" onClick={() => setPending(undefined)} autoFocus>
                Cancel
              </button>
              <button type="submit" className="danger" disabled={pending.folder && !pending.count}>
                Delete
              </button>
            </div>
          </form>
        )}
      </dialog>
    </aside>
  );
}
