import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { unsupportedMarkdown } from '../../../shared/markdown-support';
import type { Passage, SessionHighlights } from '../../../shared/wire';
import { api } from '../../components/api';
import { type Ask, docFromMarkdown, type EditorMode, type SelectionAsk, MarkdownEditor, markdownOf, mergeMarkdown, snapshot, type Snapshot } from '../markdown-editor/markdown-editor';
import './documents.css';

// One opened file: its editor document, the text it was loaded or last saved with, how many times it has
// been saved, and the document's state when it loaded (what the AI read, if it read the file from disk).
type Entry = { doc: Y.Doc; saved: string; loadBase: Snapshot; saves: number; dirty: boolean };

// A constant, so the editor sees no change while there are no highlights.
const NO_PASSAGES: Passage[] = [];

export function useDocuments() {
  const [names, setNames] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>('notes.md');
  // `current` for callbacks that outlive a render; `show` keeps it in step before React re-renders.
  const currentRef = useRef(current);
  currentRef.current = current;
  const show = (name: string) => {
    currentRef.current = name;
    setCurrent(name);
  };
  // Every file opened since the page loaded, so switching files keeps unsaved edits. Entries are
  // changed in place; `rerender` tells React about it.
  const entries = useRef(new Map<string, Entry>());
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);
  // Each document's state when the latest chat message was sent: the text the AI starts from.
  const turnBases = useRef(new Map<string, Snapshot>());
  // How many times each document had been saved when the latest chat message was sent.
  const turnSaves = useRef(new Map<string, number>());
  // The file open when the latest chat message was sent.
  const turnFile = useRef<string>(undefined);
  // AI edits the latest turn could not bring into the editor, and why.
  const [notApplied, setNotApplied] = useState<{ name: string; message: string }[]>([]);
  // The passages the latest finished turn highlighted, until the next one replaces them.
  const [highlights, setHighlights] = useState<SessionHighlights>();

  const load = (name: string, text: string) => {
    const doc = docFromMarkdown(text);
    const entry: Entry = { doc, saved: text, loadBase: snapshot(doc), saves: 0, dirty: false };
    // Tracked from edits rather than by comparing text: the editor's markdown output can differ
    // from the file (bullet style, line wrapping) even when nobody changed anything.
    entry.doc.on('update', () => {
      entry.dirty = true;
      rerender();
    });
    entries.current.set(name, entry);
  };

  const refreshList = useCallback(async () => setNames((await api('GET', '/api/documents')).documents), []);

  // Loads a file from disk the first time it is needed.
  const ensureLoaded = async (name: string) => {
    if (entries.current.has(name)) return;
    const doc = await api('GET', `/api/documents/${encodeURIComponent(name)}`);
    load(name, doc.content ?? '');
  };

  // Shows a file, loading it from disk the first time it is opened.
  const open = useCallback(async (name: string) => {
    setNotApplied([]);
    await ensureLoaded(name);
    show(name);
  }, []);

  const save = useCallback(
    async (name: string = current) => {
      const entry = entries.current.get(name);
      if (!entry?.dirty || unsupportedMarkdown(entry.saved).length) return;
      const content = markdownOf(entry.doc);
      await api('PUT', `/api/documents/${encodeURIComponent(name)}`, { content });
      // A post the AI created exists on disk only once it is saved.
      if (!names.includes(name)) await refreshList();
      entry.saved = content;
      entry.saves++;
      // Typing that landed while the save was in flight is still unsaved.
      entry.dirty = markdownOf(entry.doc) !== content;
      rerender();
    },
    [current, names, refreshList],
  );

  const create = useCallback(
    async (name: string) => {
      const file = name.endsWith('.md') ? name : `${name}.md`;
      await api('PUT', `/api/documents/${encodeURIComponent(file)}`, { content: `# ${file.replace(/\.md$/, '')}\n` });
      await refreshList();
      await open(file);
    },
    [open, refreshList],
  );

  // Captures what the editor holds as a chat message is sent. The markdown goes to the AI; the snapshot
  // taken with it is what the AI's edits are merged against, so typing done meanwhile survives.
  const beginTurn = useCallback(() => {
    const documents: Record<string, string> = {};
    turnBases.current.clear();
    turnSaves.current.clear();
    turnFile.current = currentRef.current;
    for (const [name, entry] of entries.current) {
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
      if (!names.includes(current)) {
        if (current === turnFile.current) turnFile.current = names.at(-1)!;
        show(names.at(-1)!);
      }
      const failed: { name: string; message: string }[] = [];
      for (const name of names) {
        const entry = entries.current.get(name);
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
          entries.current.get(name)!.dirty = true;
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
    refreshList().then(() => open('notes.md'));
  }, []);

  // The browser asks "Leave site?" while any file has unsaved edits, since they exist only in this page.
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if ([...entries.current.values()].some((entry) => entry.dirty)) event.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  const entry = entries.current.get(current);
  return {
    names,
    // The files on disk plus any opened only in the editor so far, such as a new post from the AI.
    listed: [...new Set([...names, ...entries.current.keys()])].sort(),
    current,
    doc: entry?.doc,
    dirty: entry?.dirty ?? false,
    unsupported: unsupportedMarkdown(entry?.saved ?? ''),
    isDirty: (name: string) => entries.current.get(name)?.dirty ?? false,
    open,
    save,
    create,
    beginTurn,
    applyEdited,
    notApplied,
    showHighlights,
    // The highlighted passages of the file on show.
    highlights: highlights?.file === current ? highlights.passages : NO_PASSAGES,
  };
}

type Documents = ReturnType<typeof useDocuments>;

export function Files({ docs }: { docs: Documents }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState('');
  return (
    <aside className="files">
      <div className="files-head">
        <h2>Documents</h2>
        <button className="add" aria-label="New document" title="New document" onClick={() => dialog.current?.showModal()}>
          +
        </button>
      </div>
      {docs.listed.map((name) => (
        <button key={name} className={`file ${name === docs.current ? 'active' : ''}`} onClick={() => docs.open(name)}>
          {name}
          {docs.isDirty(name) && <span className="unsaved"> (unsaved)</span>}
        </button>
      ))}
      <dialog
        ref={dialog}
        className="new-file"
        aria-labelledby="new-file-title"
        onClose={() => setDraft('')}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(e) => e.target === dialog.current && dialog.current.close()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) docs.create(draft.trim()).then(() => dialog.current?.close());
          }}
        >
          <h3 id="new-file-title">New document</h3>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="new-file.md" aria-label="File name" autoFocus />
          <div className="actions">
            <button type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!draft.trim()}>
              Create
            </button>
          </div>
        </form>
      </dialog>
    </aside>
  );
}

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
  // Kept here rather than in the editor, which remounts for each file, so switching files keeps the mode.
  const [mode, setMode] = useState<EditorMode>('rendered');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        docs.save();
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
        <button className="primary" disabled={!docs.dirty || docs.unsupported.length > 0} onClick={() => docs.save()}>
          Save
        </button>
      </div>
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
          mode={mode}
          onModeChange={setMode}
          onAsk={onAsk}
          onAskSelection={onAskSelection}
          askingSelection={askingSelection}
        />
      )}
    </section>
  );
}
