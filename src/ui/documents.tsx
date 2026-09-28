import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { unsupportedMarkdown } from '../shared/markdown-support';
import { api } from './api';
import { docFromMarkdown, MarkdownEditor, markdownOf } from './markdown-editor';
import './documents.css';

// One opened file: its editor document, and the text it had on disk when last loaded or saved.
type Entry = { doc: Y.Doc; saved: string; dirty: boolean; changedOnDisk: boolean };

export function useDocuments() {
  const [names, setNames] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>('notes.md');
  // Every file opened since the page loaded, so switching files keeps unsaved edits. Entries are
  // changed in place; `rerender` tells React about it.
  const entries = useRef(new Map<string, Entry>());
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);

  const load = (name: string, text: string) => {
    const entry: Entry = { doc: docFromMarkdown(text), saved: text, dirty: false, changedOnDisk: false };
    // Tracked from edits rather than by comparing text: the editor's markdown output can differ
    // from the file (bullet style, line wrapping) even when nobody changed anything.
    entry.doc.on('update', () => {
      entry.dirty = true;
      rerender();
    });
    entries.current.set(name, entry);
  };

  const refreshList = useCallback(async () => setNames((await api('GET', '/api/documents')).documents), []);

  // Loads the file from disk, replacing whatever the editor held for it.
  const reload = useCallback(async (name: string) => {
    const doc = await api('GET', `/api/documents/${encodeURIComponent(name)}`);
    load(name, doc.content ?? '');
    setCurrent(name);
    rerender();
  }, []);

  const open = useCallback(
    async (name: string) => {
      if (entries.current.has(name)) setCurrent(name);
      else await reload(name);
    },
    [reload],
  );

  const save = useCallback(
    async (name: string = current) => {
      const entry = entries.current.get(name);
      if (!entry?.dirty || unsupportedMarkdown(entry.saved).length) return;
      const content = markdownOf(entry.doc);
      await api('PUT', `/api/documents/${encodeURIComponent(name)}`, { content });
      entry.saved = content;
      // Typing that landed while the save was in flight is still unsaved.
      entry.dirty = markdownOf(entry.doc) !== content;
      entry.changedOnDisk = false;
      rerender();
    },
    [current],
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

  // Called after the agent may have touched files: reload each opened file unless it has unsaved edits.
  const syncFromDisk = useCallback(async () => {
    await refreshList();
    for (const [name, entry] of entries.current) {
      const { content } = await api('GET', `/api/documents/${encodeURIComponent(name)}`);
      if (content === undefined || content === entry.saved) continue;
      if (entry.dirty) entry.changedOnDisk = true;
      else load(name, content);
    }
    rerender();
  }, [refreshList]);

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
    current,
    doc: entry?.doc,
    dirty: entry?.dirty ?? false,
    unsupported: unsupportedMarkdown(entry?.saved ?? ''),
    changedOnDisk: entry?.changedOnDisk ?? false,
    isDirty: (name: string) => entries.current.get(name)?.dirty ?? false,
    open,
    reload,
    save,
    create,
    syncFromDisk,
  };
}

type Documents = ReturnType<typeof useDocuments>;

export function Files({ docs }: { docs: Documents }) {
  const [draft, setDraft] = useState('');
  return (
    <aside className="files">
      <h2>Documents</h2>
      {docs.names.map((name) => (
        <button key={name} className={`file ${name === docs.current ? 'active' : ''}`} onClick={() => docs.open(name)}>
          {name}
          {docs.isDirty(name) && <span className="unsaved"> (unsaved)</span>}
        </button>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) docs.create(draft.trim()).then(() => setDraft(''));
        }}
        style={{ marginTop: 10 }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="new-file.md"
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', background: 'var(--panel)' }}
        />
      </form>
    </aside>
  );
}

export function Editor({ docs }: { docs: Documents }) {
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
        {docs.changedOnDisk && (
          <span className="banner">
            The agent changed this file. <a href="#" onClick={(e) => (e.preventDefault(), docs.reload(docs.current))}>Reload</a> (discards your edits)
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="primary" disabled={!docs.dirty || docs.unsupported.length > 0} onClick={() => docs.save()}>
          Save
        </button>
      </div>
      {docs.unsupported.length > 0 && (
        <div className="notice">
          Read-only: this document has {docs.unsupported.join(' and ')}, which the editor can't keep yet. Saving would damage
          them, so editing is off for this file.
        </div>
      )}
      {docs.doc && <MarkdownEditor key={docs.current} doc={docs.doc} readOnly={docs.unsupported.length > 0} />}
    </section>
  );
}
