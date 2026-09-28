import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { unsupportedMarkdown } from '../shared/markdown-support';
import { MarkdownEditor } from './markdown-editor';
import './documents.css';

export function useDocuments() {
  const [names, setNames] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>('notes.md');
  // `saved` is the file as it is on disk; `content` is the editor's markdown.
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  // Tracked from edits rather than by comparing text: the editor's markdown output can differ
  // from the file (bullet style, line wrapping) even when nobody changed anything.
  const [dirty, setDirty] = useState(false);
  // Bumped whenever the editor must load `saved` from scratch (open, reload from disk).
  const [version, setVersion] = useState(0);
  const [changedOnDisk, setChangedOnDisk] = useState(false);
  const unsupported = useMemo(() => unsupportedMarkdown(saved), [saved]);

  const load = (name: string, text: string) => {
    setCurrent(name);
    setContent(text);
    setSaved(text);
    setDirty(false);
    setChangedOnDisk(false);
    setVersion((v) => v + 1);
  };

  const refreshList = useCallback(async () => setNames((await api('GET', '/api/documents')).documents), []);

  const open = useCallback(async (name: string) => {
    const doc = await api('GET', `/api/documents/${encodeURIComponent(name)}`);
    load(name, doc.content ?? '');
  }, []);

  const edit = useCallback((markdown: string) => {
    setContent(markdown);
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!dirty || unsupported.length) return;
    await api('PUT', `/api/documents/${encodeURIComponent(current)}`, { content });
    setSaved(content);
    setDirty(false);
    setChangedOnDisk(false);
  }, [current, content, dirty, unsupported]);

  const create = useCallback(
    async (name: string) => {
      const file = name.endsWith('.md') ? name : `${name}.md`;
      await api('PUT', `/api/documents/${encodeURIComponent(file)}`, { content: `# ${file.replace(/\.md$/, '')}\n` });
      await refreshList();
      await open(file);
    },
    [open, refreshList],
  );

  // Called after the agent may have touched files: reload unless the user has unsaved edits.
  const syncFromDisk = useCallback(async () => {
    await refreshList();
    const doc = await api('GET', `/api/documents/${encodeURIComponent(current)}`);
    if (doc.content === undefined || doc.content === saved) return;
    if (dirty) setChangedOnDisk(true);
    else load(current, doc.content);
  }, [current, saved, dirty, refreshList]);

  useEffect(() => {
    refreshList().then(() => open('notes.md'));
  }, []);

  return { names, current, content, saved, version, edit, dirty, unsupported, changedOnDisk, open, save, create, syncFromDisk };
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
            The agent changed this file. <a href="#" onClick={(e) => (e.preventDefault(), docs.open(docs.current))}>Reload</a> (discards your edits)
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="primary" disabled={!docs.dirty || docs.unsupported.length > 0} onClick={docs.save}>
          Save
        </button>
      </div>
      {docs.unsupported.length > 0 && (
        <div className="notice">
          Read-only: this document has {docs.unsupported.join(' and ')}, which the editor can't keep yet. Saving would damage
          them, so editing is off for this file.
        </div>
      )}
      <MarkdownEditor markdown={docs.saved} version={docs.version} readOnly={docs.unsupported.length > 0} onChange={docs.edit} />
    </section>
  );
}
