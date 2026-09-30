import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import * as Y from 'yjs';
import { unsupportedMarkdown } from '../../../shared/markdown-support';
import type { DocumentEntry, DocumentList, FolderCount, NotApplied, Passage, SessionData, SessionHighlights, StoredDoc, TurnProgress, ViewState } from '../../../shared/wire';
import { api } from '../../components/api';
import { movedPath, within } from '../components/paths';
import { type Ask, decodeUpdate, docFromMarkdown, encodeUpdate, type EditorMode, type SelectionAsk, MarkdownEditor, markdownOf, mergeMarkdown, snapshot, snapshotFromUpdate, type Snapshot } from '../markdown-editor/markdown-editor';
import './documents.css';

// One opened file: its editor document, the text it was loaded or last saved with, how many times it has
// been saved, and the document's state when it loaded (what the AI read, if it read the file from disk).
type Entry = { doc: Y.Doc; saved: string; loadBase: Snapshot; saves: number; dirty: boolean };

// A constant, so the editor sees no change while there are no highlights.
const NO_PASSAGES: Passage[] = [];

export function useDocuments() {
  // The workspace's folders and files on disk.
  const [entries, setEntries] = useState<DocumentEntry[]>([]);
  // The file on show; undefined until the writer opens one, or until a reload brings back the one that was open.
  const [current, setCurrent] = useState<string>();
  // `current` for callbacks that outlive a render; `show` keeps it in step before React re-renders.
  const currentRef = useRef(current);
  currentRef.current = current;
  const show = (name: string | undefined) => {
    currentRef.current = name;
    setCurrent(name);
  };
  // Every file opened since the page loaded, plus those a reload brought back with unsaved edits, so switching files
  // keeps unsaved edits. Entries are changed in place; `rerender` tells React about it.
  const opened = useRef(new Map<string, Entry>());
  const [version, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);
  // Each document's state when the latest chat message was sent: the text the AI starts from.
  const turnBases = useRef(new Map<string, Snapshot>());
  // How many times each document had been saved when the latest chat message was sent.
  const turnSaves = useRef(new Map<string, number>());
  // The file open when the latest chat message was sent.
  const turnFile = useRef<string>(undefined);
  // The id of the last reply whose edits and highlights the editor took in, so a reload never applies one twice.
  const appliedTurn = useRef<string>(undefined);
  // AI edits the latest turn could not bring into the editor, and why.
  const [notApplied, setNotApplied] = useState<NotApplied[]>([]);
  // The passages the latest finished turn highlighted, until the next one replaces them.
  const [highlights, setHighlights] = useState<SessionHighlights>();
  // Rendered or raw. Kept here rather than in the editor, which remounts for each file, so switching files keeps it.
  const [mode, setMode] = useState<EditorMode>('rendered');
  // True once the stored view is back: from then on, every change to the view is stored.
  const [restored, setRestored] = useState(false);
  const restoredRef = useRef(restored);
  restoredRef.current = restored;

  // Tracks unsaved edits from the document's own changes rather than by comparing text: the editor's markdown output
  // can differ from the file (bullet style, line wrapping) even when nobody changed anything.
  const track = (name: string, entry: Entry) => {
    entry.doc.on('update', () => {
      entry.dirty = true;
      rerender();
    });
    opened.current.set(name, entry);
  };

  const load = (name: string, text: string) => {
    const doc = docFromMarkdown(text);
    track(name, { doc, saved: text, loadBase: snapshot(doc), saves: 0, dirty: false });
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
      turnBases.current = new Map([...turnBases.current].map(([name, base]) => [renamed(name), base]));
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
    // Stored without the pause, so a reload right after Send still merges the AI's edits against what it was sent.
    if (restoredRef.current) writeView();
    return { documents };
  }, []);

  // Brings a finished turn's edits into the editor: `edited` is each edited post's final markdown.
  const applyEdited = useCallback(
    (edited: Record<string, string>) => {
      const names = Object.keys(edited);
      if (!names.length) return;
      // Read through the ref, since a restored page applies a pending reply from the render that started restoring.
      const current = currentRef.current;
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
          // The next report of this post from the same turn merges from what this one left.
          if (entry) turnBases.current.set(name, mergeMarkdown(entry.doc, turnBase ?? entry.loadBase, edited[name]));
          else load(name, edited[name]);
          opened.current.get(name)!.dirty = true;
        } catch (error) {
          failed.push({ name, message: error instanceof Error ? error.message : String(error) });
        }
      }
      setNotApplied(failed);
      rerender();
    },
    [],
  );

  // Shows `next`'s highlights, or clears them when given none, as a new chat does. The editor moves to the
  // highlighted post only if the writer is still on the file they sent the message from.
  const showHighlights = useCallback(async (next: SessionHighlights | undefined) => {
    setHighlights(next);
    const stayed = () => currentRef.current === turnFile.current;
    if (!next || !stayed()) return;
    await ensureLoaded(next.file);
    // Loading takes a moment, and the writer may have moved meanwhile.
    if (stayed()) show(next.file);
  }, []);

  // Brings back the view stored before a reload. Each piece succeeds or fails on its own: one that cannot be used is
  // dropped, and the rest still comes back.
  const restore = useCallback(async (view: ViewState) => {
    for (const stored of view.unsaved) {
      try {
        track(stored.name, restoredEntry(stored));
      } catch (error) {
        console.error(`Could not restore the unsaved changes to ${stored.name}:`, error);
      }
    }
    try {
      if (view.turn) {
        turnFile.current = view.turn.file;
        turnBases.current = new Map(Object.entries(view.turn.bases).map(([name, base]) => [name, snapshotFromUpdate(decodeUpdate(base))]));
      }
    } catch (error) {
      console.error('Could not restore what the latest chat message was sent with:', error);
    }
    appliedTurn.current = view.appliedTurn;
    let file = view.current;
    if (file !== undefined) {
      try {
        await ensureLoaded(file);
      } catch (error) {
        console.error(`Could not reopen ${file}:`, error);
        file = undefined;
      }
    }
    show(file);
    setHighlights(view.highlights);
    setNotApplied(view.notApplied);
    setMode(view.mode);
    setRestored(true);
    rerender();
  }, []);

  // Why the stored view could not be loaded. The writer stays off for this page load, so it cannot overwrite the
  // stored drafts, and leaving warns for unsaved edits as it did before views were stored.
  const [restoreError, setRestoreError] = useState<string>();
  const restoreFailed = useCallback((error: Error) => {
    setRestoreError(`Could not load your saved editor state: ${error.message}. Changes on this page will not survive a reload.`);
  }, []);

  // The view as it stands, read when it is written so a write always stores the latest.
  const latest = useRef({ highlights, notApplied, mode });
  latest.current = { highlights, notApplied, mode };
  const viewState = (): ViewState => ({
    current: currentRef.current,
    mode: latest.current.mode,
    unsaved: [...opened.current].flatMap(([name, entry]) =>
      entry.dirty ? [{ name, saved: entry.saved, doc: encodeUpdate(Y.encodeStateAsUpdate(entry.doc)), loadBase: encodeUpdate(entry.loadBase.update) }] : [],
    ),
    highlights: latest.current.highlights,
    notApplied: latest.current.notApplied,
    appliedTurn: appliedTurn.current,
    turn: {
      file: turnFile.current,
      bases: Object.fromEntries([...turnBases.current].map(([name, base]) => [name, encodeUpdate(base.update)])),
    },
  });

  // One write at a time: a change while one is in flight asks for exactly one more, with the latest view, once it lands.
  // `waiting` covers the pause before a write; `failed` holds until a later write lands.
  const writing = useRef({ waiting: false, inFlight: false, again: false, failed: false });
  // Why the last write failed, until one lands.
  const [writeError, setWriteError] = useState<string>();
  const writeView = async () => {
    const write = writing.current;
    write.waiting = false;
    if (write.inFlight) {
      write.again = true;
      return;
    }
    write.inFlight = true;
    try {
      await api('PUT', '/api/view-state', viewState());
      write.failed = false;
      setWriteError(undefined);
    } catch (error) {
      write.failed = true;
      setWriteError(`Changes are not saved to disk: ${(error as Error).message}`);
    } finally {
      write.inFlight = false;
      if (write.again) {
        write.again = false;
        writeView();
      }
    }
  };
  // Stores the view a short pause after the last change. A change during the pause starts it again.
  useEffect(() => {
    if (!restored) return;
    writing.current.waiting = true;
    const timer = setTimeout(writeView, 300);
    return () => clearTimeout(timer);
  }, [restored, version, current, mode, highlights, notApplied]);

  // The one way a finished turn's edits and highlights enter the editor. The edits and the note that this reply was
  // applied change together, so they are stored in the same write. A turn that made no Highlight call leaves the
  // earlier highlights, so a question still open stays marked; a passage whose text it edited away drops out.
  const applyTurn = async (messageId: string, data: SessionData) => {
    applyEdited(data.edited);
    appliedTurn.current = messageId;
    rerender();
    if (data.highlights) await showHighlights(data.highlights);
  };

  // Brings what a running turn has done so far into the editor, as it happens.
  const applyProgress = (data: TurnProgress) => {
    applyEdited(data.edited);
  };

  // Applies the chat's last reply if it ran to the end while no page was there to take it in: a turn that finished
  // during a reload, or while the page waited on it.
  const applyPending = async (messages: UIMessage[]) => {
    const reply = messages.findLast((message) => message.role === 'assistant');
    const session = reply?.parts.findLast((part) => part.type === 'data-session') as { data: SessionData } | undefined;
    if (!reply || !session || session.data.aborted || reply.id === appliedTurn.current) return;
    await applyTurn(reply.id, session.data);
  };

  useEffect(() => {
    refreshList();
  }, []);

  // The browser asks "Leave site?" while a change has not reached the disk yet. Until the stored view is back, unsaved
  // edits exist only in this page, so any of them counts.
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      const { waiting, inFlight, failed } = writing.current;
      const unstored = restoredRef.current ? waiting || inFlight || failed : [...opened.current.values()].some((entry) => entry.dirty);
      if (unstored) event.preventDefault();
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
    restore,
    applyTurn,
    applyProgress,
    applyPending,
    restoreFailed,
    restoreError,
    writeError,
  };
}

// A file with unsaved changes as it was before a reload, still unsaved. Its update is applied before anything listens,
// so bringing it back is not an edit.
function restoredEntry(stored: StoredDoc): Entry {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, decodeUpdate(stored.doc));
  return { doc, saved: stored.saved, loadBase: snapshotFromUpdate(decodeUpdate(stored.loadBase)), saves: 0, dirty: true };
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
      {docs.restoreError && (
        <div className="notice" role="alert">
          {docs.restoreError}
        </div>
      )}
      {docs.writeError && (
        <div className="notice" role="alert">
          {docs.writeError}
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
          onClearHighlights={() => docs.showHighlights(undefined)}
        />
      )}
    </section>
  );
}
