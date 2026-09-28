import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, render, renderHook, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import { Editor, Files, useDocuments } from './documents';
import { markdownOf } from './markdown-editor';

const realFetch = globalThis.fetch;
// The workspace's files, as the documents routes would read and write them.
let disk: Map<string, string>;

beforeEach(() => {
  disk = new Map([
    ['notes.md', '# Notes\n'],
    ['ideas.md', '# Ideas\n'],
  ]);
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    const name = decodeURIComponent(String(url).replace('/api/documents', '').replace(/^\//, ''));
    if (!name) return Response.json({ documents: [...disk.keys()].sort() });
    if (init?.method === 'PUT') {
      disk.set(name, JSON.parse(String(init.body)).content);
      return Response.json({ ok: true });
    }
    return disk.has(name) ? Response.json({ name, content: disk.get(name) }) : Response.json({ error: 'not found' }, { status: 404 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Types at the end of a document's first block, the way the editor's keystrokes reach it.
function typeInto(doc: Y.Doc, text: string) {
  doc.transact(() => {
    const block = doc.getXmlFragment('prosemirror').get(0) as Y.XmlElement;
    const words = block.get(0) as Y.XmlText;
    words.insert(words.length, text);
  }, ySyncPluginKey);
}

async function documents() {
  const hook = renderHook(() => useDocuments());
  await act(async () => {});
  return hook.result;
}

test('switching files keeps the unsaved text of the file left behind', async () => {
  const docs = await documents();
  await act(async () => typeInto(docs.current.doc!, ' for today'));

  await act(() => docs.current.open('ideas.md'));
  await act(() => docs.current.open('notes.md'));

  expect(markdownOf(docs.current.doc!)).toBe('# Notes for today');
  expect(docs.current.dirty).toBe(true);
});

test('saving one file leaves the other files unsaved', async () => {
  const docs = await documents();
  await act(async () => typeInto(docs.current.doc!, ' for today'));
  await act(() => docs.current.open('ideas.md'));
  await act(async () => typeInto(docs.current.doc!, ' to try'));

  await act(() => docs.current.save('notes.md'));

  expect(disk.get('notes.md')).toBe('# Notes for today');
  expect(docs.current.isDirty('notes.md')).toBe(false);
  expect(docs.current.isDirty('ideas.md')).toBe(true);
  expect(disk.get('ideas.md')).toBe('# Ideas\n');
});

test('after a turn, an opened file the AI changed on disk shows the new text even when it is not the one shown', async () => {
  const docs = await documents();
  await act(() => docs.current.open('ideas.md'));
  disk.set('notes.md', '# Notes from the AI\n');

  await act(() => docs.current.syncFromDisk());
  await act(() => docs.current.open('notes.md'));

  expect(markdownOf(docs.current.doc!)).toBe('# Notes from the AI');
});

test('after a turn, an opened file with unsaved edits that the AI changed on disk is marked, not replaced', async () => {
  const docs = await documents();
  await act(async () => typeInto(docs.current.doc!, ' for today'));
  await act(() => docs.current.open('ideas.md'));
  disk.set('notes.md', '# Notes from the AI\n');

  await act(() => docs.current.syncFromDisk());
  await act(() => docs.current.open('notes.md'));

  expect(markdownOf(docs.current.doc!)).toBe('# Notes for today');
  expect(docs.current.changedOnDisk).toBe(true);
});

// True when the browser would ask "Leave site? Changes you made may not be saved."
function leavingWarns() {
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  return leaving.defaultPrevented;
}

test('leaving the page warns while any file has unsaved changes', async () => {
  const docs = await documents();
  expect(leavingWarns()).toBe(false);

  await act(async () => typeInto(docs.current.doc!, ' for today'));
  await act(() => docs.current.open('ideas.md'));
  expect(leavingWarns()).toBe(true);

  await act(() => docs.current.save('notes.md'));
  expect(leavingWarns()).toBe(false);
});

test('the documents list marks each file with unsaved changes', async () => {
  const docs = await documents();
  await act(async () => typeInto(docs.current.doc!, ' for today'));

  render(<Files docs={docs.current} />);

  expect(screen.getByRole('button', { name: 'notes.md (unsaved)' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'ideas.md' })).toBeTruthy();
});

test('a file just opened in the editor has no unsaved changes', async () => {
  disk.set('notes.md', '# Notes\n\n* one\n* two\n\nSome *text*.\n');
  const docs = await documents();

  render(<Editor docs={docs.current} />);
  await act(async () => {});

  expect(docs.current.dirty).toBe(false);
  expect(screen.getByText('saved')).toBeTruthy();
});
