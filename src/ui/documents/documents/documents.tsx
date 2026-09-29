import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { unsupportedMarkdown } from '../../../shared/markdown-support';
import type { DocumentEntry, DocumentList, FolderCount, NotApplied, Passage, SessionHighlights } from '../../../shared/wire';
import { api } from '../../components/api';
import { movedPath, within } from '../components/paths';
import { type Ask, docFromMarkdown, type EditorMode, type SelectionAsk, MarkdownEditor, markdownOf, mergeMarkdown, snapshot, type Snapshot } from '../markdown-editor/markdown-editor';
import './documents.css';

// One opened file: its editor document, the text it was loaded or last saved with, how many times it has
// been saved, and the document's state when it loaded (what the AI read, if it read the file from disk).
type Entry = { doc: Y.Doc; saved: string; loadBase: Snapshot; saves: number; dirty: boolean };

// A constant, so the editor sees no change while there are no highlights.
const NO_PASSAGES: Passage[] = [];

export function useDocuments() {
  // The workspace's folders and files on disk.
  const [entries, setEntries] = useState<DocumentEntry[]>([]);
  // The file on show; undefined until the writer opens one, since nothing opens when the page loads.
  const [current, setCurrent] = useState<string>();
  // `current` for callbacks that outlive a render; `show` keeps it in step before React re-renders.
  const currentRef = useRef(current);
  currentRef.current = current;
  const show = (name: string | undefined) => {
    currentRef.current = name;
    setCurrent(name);
  };
  // Every file opened since the page loaded, so switching files keeps unsaved edits. Entries are
  // changed in place; `rerender` tells React about it.
  const opened = useRef(new Map<string, Entry>());
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);
  // Each document's state when the latest chat message was sent: the text the AI starts from.
  const turnBases = useRef(new Map<string, Snapshot>());
  // How many times each document had been saved when the latest chat message was sent.
  const turnSaves = useRef(new Map<string, number>());
  // The file open when the latest chat message was sent.
  const turnFile = useRef<string>(undefined);
  // AI edits the latest turn could not bring into the editor, and why.
  const [notApplied, setNotApplied] = useState<NotApplied[]>([]);
  // The passages the latest finished turn highlighted, until the next one replaces them.
  const [highlights, setHighlights] = useState<SessionHighlights>();
  // Rendered or raw. Kept here rather than in the editor, which remounts for each file, so switching files keeps it.
  const [mode, setMode] = useState<EditorMode>('rendered');

  const load = (name: string, text: string) => {
    const doc = docFromMarkdown(text);
    const entry: Entry = { doc, saved: text, loadBase: snapshot(doc), saves: 0, dirty: false };
    // Tracked from edits rather than by comparing text: the editor's markdown output can differ
    // from the file (bullet style, line wrapping) even when nobody changed anything.
    entry.doc.on('update', () => {
      entry.dirty = true;
      rerender();
    });
    opened.current.set(name, entry);
  };

  const refreshList = useCallback(async () => setEntries((await api<DocumentList>('GET', '/api/documents')).entries), []);

  // Loads in progress, by file name, so two callers wanting one file share a single load.
  const loading = useRef(new Map<string, Promise<void>>());

  // Loads a file from disk the first time it is needed. A load that fails is forgotten, so the next call tries again.
  const ensureLoaded = (name: string): Promise<void> => {
    if (opened.current.has(name)) return Promise.resolve();
    let pending = loading.current.get(name);
    if (!pending) {
      pending = api('GET', `/api/documents/${encodeURIComponent(name)}`)
        .then((doc) => load(name, doc.content ?? ''))
        .finally(() => loading.current.delete(name));
      loading.current.set(name, pending);
    }
    return pending;
  };

  // Shows a file, loading it from disk the first time it is opened.
  const open = useCallback(async (name: string) => {
    setNotApplied([]);
    await ensureLoaded(name);
    show(name);
    // The first file opens while `current` already names it, so showing it alone would not re-render.
    rerender();
  }, []);

  const save = useCallback(
    async (name: string | undefined = current) => {
      if (name === undefined) return;
      const entry = opened.current.get(name);
      if (!entry?.dirty || unsupportedMarkdown(entry.saved).length) return;
      const content = markdownOf(entry.doc);
      await api('PUT', `/api/documents/${encodeURIComponent(name)}`, { content });
      // A post the AI created exists on disk only once it is saved.
      if (!entries.some((e) => e.path === name)) await refreshList();
      entry.saved = content;
      entry.saves++;
      // Typing that landed while the save was in flight is still unsaved.
      entry.dirty = markdownOf(entry.doc) !== content;
      // Highlights that mark changes to this post are done once the changes are saved.
      setHighlights((shown) => (shown?.untilSaved && shown.file === name ? undefined : shown));
      rerender();
    },
    [current, entries, refreshList],
  );

  // Creates an empty folder, or a new file, which then opens. Nothing is overwritten: a taken path rejects.
  const createEntry = useCallback(
    async (path: string, kind: 'file' | 'folder') => {
      await api('POST', '/api/documents/create', { path, kind });
      await refreshList();
      if (kind === 'file') await open(path);
    },
    [open, refreshList],
  );

  // Renames or moves a file or folder on disk, then re-files every open file at or under it by its new path, so
  // unsaved edits come along and the next Save writes the new path.
  const move = useCallback(
    async (from: string, to: string) => {
      await api('POST', '/api/documents/move', { from, to });
      const renamed = (path: string) => movedPath(path, from, to) ?? path;
      opened.current = new Map([...opened.current].map(([name, entry]) => [renamed(name), entry]));
      if (currentRef.current !== undefined) show(renamed(currentRef.current));
      setHighlights((before) => before && { ...before, file: renamed(before.file) });
      setNotApplied([]);
      await refreshList();
    },
    [refreshList],
  );

  // Deletes a file, or a folder and everything in it, then drops every open file at or under it. Their unsaved edits
  // go too: the delete confirmation names them first.
  const remove = useCallback(
    async (path: string) => {
      await api('POST', '/api/documents/delete', { path });
      for (const name of [...opened.current.keys()]) if (within(name, path)) opened.current.delete(name);
      if (currentRef.current !== undefined && within(currentRef.current, path)) show(undefined);
      setHighlights((before) => (before && within(before.file, path) ? undefined : before));
      await refreshList();
    },
    [refreshList],
  );

  const countContents = useCallback((path: string) => api<FolderCount>('POST', '/api/documents/count', { path }), []);

  // Captures what the editor holds as a chat message is sent. The markdown goes to the AI; the snapshot
  // taken with it is what the AI's edits are merged against, so typing done meanwhile survives.
  const beginTurn = useCallback(() => {
    const documents: Record<string, string> = {};
    turnBases.current.clear();
    turnSaves.current.clear();
    turnFile.current = currentRef.current;
    for (const [name, entry] of opened.current) {
      turnSaves.current.set(name, entry.saves);
      if (unsupportedMarkdown(entry.saved).length) continue;
      documents[name] = markdownOf(entry.doc);
      turnBases.current.set(name, snapshot(entry.doc));
    }
    return { documents };
  }, []);

  // Brings a finished turn's edits into the editor: `edited` is each edited post's final markdown.
  const applyEdited = useCallback(
    (edited: Record<string, string>) => {
      const names = Object.keys(edited);
      if (!names.length) return;
      // Stay on the open file if the AI changed it; otherwise show the file it changed last. That move is
      // the AI's, so the writer still counts as on the file they sent the message from.
      if (current === undefined || !names.includes(current)) {
        if (current === turnFile.current) turnFile.current = names.at(-1)!;
        show(names.at(-1)!);
      }
      const failed: NotApplied[] = [];
      for (const name of names) {
        const entry = opened.current.get(name);
        const turnBase = turnBases.current.get(name);
        // With no base from Send, the AI read the file from disk at some point during the turn. A save
        // since then means the load-time base may be older than what the AI read, so merging from it
        // could repeat the user's saved text.
        if (entry && !turnBase && entry.saves > (turnSaves.current.get(name) ?? 0)) {
          failed.push({ name, message: 'it was saved while the AI was working; ask again' });
          continue;
        }
        // Each file succeeds or fails on its own, so one bad merge can't lose the others' edits.
        try {
          if (entry) mergeMarkdown(entry.doc, turnBase ?? entry.loadBase, edited[name]);
          else load(name, edited[name]);
          opened.current.get(name)!.dirty = true;
        } catch (error) {
          failed.push({ name, message: error instanceof Error ? error.message : String(error) });
        }
      }
      setNotApplied(failed);
      rerender();
    },
    [current],
  );

  // Shows a finished turn's highlights, or clears them when it made none. The editor moves to the
  // highlighted post only if the writer is still on the file they sent the message from.
  const showHighlights = useCallback(async (next: SessionHighlights | undefined) => {
    setHighlights(next);
    const stayed = () => currentRef.current === turnFile.current;
    if (!next || !stayed()) return;
    await ensureLoaded(next.file);
    // Loading takes a moment, and the writer may have moved meanwhile.
    if (stayed()) show(next.file);
  }, []);

  useEffect(() => {
    refreshList();
  }, []);

  // The browser asks "Leave site?" while any file has unsaved edits, since they exist only in this page.
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if ([...opened.current.values()].some((entry) => entry.dirty)) event.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  const entry = current === undefined ? undefined : opened.current.get(current);
  return {
    entries,
    listed: listed(entries, [...opened.current.keys()]),
    current,
    doc: entry?.doc,
    dirty: entry?.dirty ?? false,
    unsupported: unsupportedMarkdown(entry?.saved ?? ''),
    isDirty: (name: string) => opened.current.get(name)?.dirty ?? false,
    open,
    save,
    createEntry,
    move,
    remove,
    countContents,
    // The open files at or under `path` with unsaved edits.
    dirtyWithin: (path: string) => [...opened.current].flatMap(([name, entry]) => (entry.dirty && within(name, path) ? [name] : [])),
    beginTurn,
    applyEdited,
    notApplied,
    showHighlights,
    // The highlighted passages of the file on show.
    highlights: highlights && highlights.file === current ? highlights.passages : NO_PASSAGES,
    mode,
    setMode,
  };
}

// The entries on disk, plus files opened only in the editor so far (such as a new post from the AI) and the folders
// they imply, each marked with whether it is on disk. Each path appears once, sorted with `<`.
function listed(entries: DocumentEntry[], openedFiles: string[]): (DocumentEntry & { onDisk: boolean })[] {
  const all = new Map(entries.map((e) => [e.path, { ...e, onDisk: true }]));
  for (const file of openedFiles) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      if (!all.has(folder)) all.set(folder, { path: folder, kind: 'folder', onDisk: false });
    }
    if (!all.has(file)) all.set(file, { path: file, kind: 'file', onDisk: false });
  }
  return [...all.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}

export type Documents = ReturnType<typeof useDocuments>;

// `onAsk` is called when the writer clicks a highlighted passage's label, and `onAskSelection` when they click the
// button beside their selection; `askingSelection` says the popup that button opened is showing.
export function Editor({
  docs,
  onAsk,
  onAskSelection,
  askingSelection,
}: {
  docs: Documents;
  onAsk?: (ask: Ask) => void;
  onAskSelection?: (ask: SelectionAsk) => void;
  askingSelection?: boolean;
}) {
  // Why the last save failed, until a save succeeds.
  const [saveError, setSaveError] = useState<string>();
  const save = () => {
    const name = docs.current;
    docs.save().then(
      () => setSaveError(undefined),
      (error: Error) => setSaveError(`Could not save ${name}: ${error.message}`),
    );
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docs.save]);

  return (
    <section className="editor">
      <div className="editor-bar">
        <span className="name">{docs.current}</span>
        <span className="muted small">{docs.dirty ? 'unsaved changes' : 'saved'}</span>
        <span style={{ flex: 1 }} />
        <button className="primary" disabled={!docs.dirty || docs.unsupported.length > 0} onClick={save}>
          Save
        </button>
      </div>
      {docs.current === undefined && <div className="select-file muted">Select a file</div>}
      {saveError && (
        <div className="notice" role="alert">
          {saveError}
        </div>
      )}
      {docs.notApplied.map(({ name, message }) => (
        <div key={name} className="notice" role="alert">
          Could not apply the AI's edit to {name}: {message}
        </div>
      ))}
      {docs.unsupported.length > 0 && (
        <div className="notice">
          Read-only: this document has {docs.unsupported.join(' and ')}, which the editor can't keep yet. Saving would damage
          them, so editing is off for this file.
        </div>
      )}
      {docs.doc && (
        <MarkdownEditor
          key={docs.current}
          doc={docs.doc}
          readOnly={docs.unsupported.length > 0}
          highlights={docs.highlights}
          mode={docs.mode}
          onModeChange={docs.setMode}
          onAsk={onAsk}
          onAskSelection={onAskSelection}
          askingSelection={askingSelection}
        />
      )}
    </section>
  );
}
