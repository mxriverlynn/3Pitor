import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import { Editor, Files, useDocuments } from './documents';
import { type Ask, markdownOf } from '../markdown-editor/markdown-editor';

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

test('a turn starts from the markdown of every opened file the editor can hold, saved or not', async () => {
  disk.set('plan.md', '| a | b |\n| - | - |\n| 1 | 2 |\n');
  const docs = await documents();
  await act(async () => typeInto(docs.current.doc!, ' for today'));
  await act(() => docs.current.open('ideas.md'));
  await act(() => docs.current.open('plan.md'));

  expect(docs.current.beginTurn()).toEqual({ documents: { 'notes.md': '# Notes for today', 'ideas.md': '# Ideas' } });
});

test('an AI edit to a file that is not open opens it, unsaved, with the AI text', async () => {
  const docs = await documents();
  docs.current.beginTurn();

  await act(async () => docs.current.applyEdited({ 'ideas.md': '# Ideas kept\n' }));

  expect(docs.current.current).toBe('ideas.md');
  expect(markdownOf(docs.current.doc!)).toBe('# Ideas kept');
  expect(docs.current.dirty).toBe(true);
  expect(disk.get('ideas.md')).toBe('# Ideas\n');
});

test('an AI edit to the open file merges with typing done after the message was sent, and the file stays open', async () => {
  const docs = await documents();
  docs.current.beginTurn();
  await act(async () => typeInto(docs.current.doc!, ' for today'));

  await act(async () => docs.current.applyEdited({ 'ideas.md': '# Ideas kept\n', 'notes.md': '# Garden Notes\n' }));

  expect(docs.current.current).toBe('notes.md');
  expect(markdownOf(docs.current.doc!)).toBe('# Garden Notes for today');
});

test('an AI edit to a file opened after the message was sent merges with typing done since it opened', async () => {
  const docs = await documents();
  docs.current.beginTurn();
  await act(() => docs.current.open('ideas.md'));
  await act(async () => typeInto(docs.current.doc!, ' to try'));

  await act(async () => docs.current.applyEdited({ 'ideas.md': '# Big Ideas\n' }));

  expect(markdownOf(docs.current.doc!)).toBe('# Big Ideas to try');
});

test('an AI edit to a file opened and saved after the message was sent is not applied, and says why', async () => {
  const docs = await documents();
  docs.current.beginTurn();
  await act(() => docs.current.open('ideas.md'));
  await act(async () => typeInto(docs.current.doc!, ' to try'));
  await act(() => docs.current.save('ideas.md'));

  await act(async () => docs.current.applyEdited({ 'ideas.md': '# Big Ideas\n' }));

  expect(markdownOf(docs.current.doc!)).toBe('# Ideas to try');
  expect(docs.current.notApplied).toEqual([{ name: 'ideas.md', message: 'it was saved while the AI was working; ask again' }]);
});

test('an AI edit that fails to merge into one file still reaches the others, and the failure is shown', async () => {
  const editor = await import('../markdown-editor/markdown-editor');
  const realMerge = editor.mergeMarkdown;
  mock.module('../markdown-editor/markdown-editor', () => ({
    ...editor,
    mergeMarkdown: (live: Y.Doc, base: Parameters<typeof realMerge>[1], markdown: string) => {
      if (markdown.includes('Ideas')) throw new Error('the merge broke');
      realMerge(live, base, markdown);
    },
  }));
  try {
    const docs = await documents();
    await act(() => docs.current.open('ideas.md'));
    await act(() => docs.current.open('notes.md'));
    docs.current.beginTurn();

    await act(async () => docs.current.applyEdited({ 'ideas.md': '# Big Ideas\n', 'notes.md': '# Garden Notes\n' }));

    expect(markdownOf(docs.current.doc!)).toBe('# Garden Notes');
    expect(docs.current.isDirty('notes.md')).toBe(true);
    expect(docs.current.isDirty('ideas.md')).toBe(false);
    expect(docs.current.notApplied).toEqual([{ name: 'ideas.md', message: 'the merge broke' }]);
  } finally {
    mock.module('../markdown-editor/markdown-editor', () => ({ ...editor, mergeMarkdown: realMerge }));
  }
});

test('the editor shows each AI edit that could not be applied', async () => {
  const docs = await documents();
  docs.current.beginTurn();
  await act(() => docs.current.open('ideas.md'));
  await act(async () => typeInto(docs.current.doc!, ' to try'));
  await act(() => docs.current.save('ideas.md'));
  await act(async () => docs.current.applyEdited({ 'ideas.md': '# Big Ideas\n' }));

  render(<Editor docs={docs.current} />);

  expect(screen.getByRole('alert').textContent).toBe(
    "Could not apply the AI's edit to ideas.md: it was saved while the AI was working; ask again",
  );
});

test('opening another file clears the edits that could not be applied', async () => {
  const docs = await documents();
  docs.current.beginTurn();
  await act(() => docs.current.open('ideas.md'));
  await act(async () => typeInto(docs.current.doc!, ' to try'));
  await act(() => docs.current.save('ideas.md'));
  await act(async () => docs.current.applyEdited({ 'ideas.md': '# Big Ideas\n' }));

  await act(() => docs.current.open('notes.md'));

  expect(docs.current.notApplied).toEqual([]);
});

test('when the AI edits several files and none is open, the one it changed last is shown', async () => {
  disk.set('plan.md', '# Plan\n');
  const docs = await documents();
  docs.current.beginTurn();

  await act(async () => docs.current.applyEdited({ 'plan.md': '# Garden Plan\n', 'ideas.md': '# Big Ideas\n' }));

  expect(docs.current.current).toBe('ideas.md');
  expect(docs.current.isDirty('plan.md')).toBe(true);
});

test('a new post from the AI is listed as unsaved, and becomes a file when saved', async () => {
  const docs = await documents();
  docs.current.beginTurn();
  await act(async () => docs.current.applyEdited({ 'garden.md': '# Garden\n' }));
  render(<Files docs={docs.current} />);
  expect(screen.getByRole('button', { name: 'garden.md (unsaved)' })).toBeTruthy();

  await act(() => docs.current.save('garden.md'));

  expect(disk.get('garden.md')).toBe('# Garden');
  expect(docs.current.names).toContain('garden.md');
});

test('the + button next to Documents opens a dialog that creates and opens a new file', async () => {
  const docs = await documents();
  const { rerender } = render(<Files docs={docs.current} />);
  const dialog = document.querySelector('dialog')!;
  expect(dialog.open).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'New document' }));
  expect(dialog.open).toBe(true);
  fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), { target: { value: 'garden' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create' })));
  rerender(<Files docs={docs.current} />);

  expect(disk.get('garden.md')).toBe('# garden\n');
  expect(docs.current.current).toBe('garden.md');
  expect(dialog.open).toBe(false);
  expect(screen.getByRole('button', { name: 'garden.md' })).toBeTruthy();
});

test('cancelling the new file dialog closes it without creating a file', async () => {
  const docs = await documents();
  render(<Files docs={docs.current} />);
  const dialog = document.querySelector('dialog')!;

  fireEvent.click(screen.getByRole('button', { name: 'New document' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), { target: { value: 'garden' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(dialog.open).toBe(false);
  expect(disk.has('garden.md')).toBe(false);
});

const Q1 = { quote: 'Notes', label: 'Q1' };

test('a finished turn’s highlights of the open post are handed to its editor', async () => {
  const docs = await documents();
  docs.current.beginTurn();

  await act(() => docs.current.showHighlights({ file: 'notes.md', passages: [Q1] }));

  expect(docs.current.highlights).toEqual([Q1]);
});

test('highlights of another post show that post, unless the writer changed files since sending', async () => {
  disk.set('plan.md', '# Plan\n');
  const docs = await documents();
  await act(() => docs.current.open('ideas.md'));
  await act(() => docs.current.open('notes.md'));
  docs.current.beginTurn();

  await act(() => docs.current.showHighlights({ file: 'ideas.md', passages: [Q1] }));
  expect(docs.current.current).toBe('ideas.md');
  expect(docs.current.highlights).toEqual([Q1]);

  docs.current.beginTurn();
  await act(() => docs.current.open('plan.md'));
  await act(() => docs.current.showHighlights({ file: 'notes.md', passages: [Q1] }));
  expect(docs.current.current).toBe('plan.md');
  expect(docs.current.highlights).toEqual([]);
});

test('a finished turn with no highlights clears the earlier ones', async () => {
  const docs = await documents();
  docs.current.beginTurn();
  await act(() => docs.current.showHighlights({ file: 'notes.md', passages: [Q1] }));

  await act(() => docs.current.showHighlights(undefined));

  expect(docs.current.highlights).toEqual([]);
});

test('highlights of a post not yet open load it from disk, and keep the edits that could not be applied', async () => {
  disk.set('plan.md', '# Plan\n');
  const docs = await documents();
  docs.current.beginTurn();
  await act(() => docs.current.open('ideas.md'));
  await act(async () => typeInto(docs.current.doc!, ' to try'));
  await act(() => docs.current.save('ideas.md'));
  await act(() => docs.current.open('notes.md'));

  // As the app does at the end of a turn: the edits, then the highlights.
  await act(async () => {
    docs.current.applyEdited({ 'ideas.md': '# Big Ideas\n' });
    await docs.current.showHighlights({ file: 'plan.md', passages: [Q1] });
  });

  expect(docs.current.current).toBe('plan.md');
  expect(markdownOf(docs.current.doc!)).toBe('# Plan');
  expect(docs.current.highlights).toEqual([Q1]);
  expect(docs.current.notApplied.map((n) => n.name)).toEqual(['ideas.md']);
});

test('showing the post the AI edited does not count as the writer changing files', async () => {
  disk.set('plan.md', '# Plan\n');
  const docs = await documents();
  docs.current.beginTurn();

  await act(async () => docs.current.applyEdited({ 'ideas.md': '# Big Ideas\n' }));
  await act(() => docs.current.showHighlights({ file: 'plan.md', passages: [Q1] }));

  expect(docs.current.current).toBe('plan.md');
  expect(docs.current.highlights).toEqual([Q1]);
});

test('the editor highlights the passages again after switching to another file and back', async () => {
  const docs = await documents();
  docs.current.beginTurn();
  await act(() => docs.current.showHighlights({ file: 'notes.md', passages: [Q1] }));
  const view = render(<Editor docs={docs.current} />);
  const marks = () => [...view.container.querySelectorAll('mark.ai-highlight')].map((el) => el.textContent);
  expect(marks()).toEqual(['Notes']);

  await act(() => docs.current.open('ideas.md'));
  view.rerender(<Editor docs={docs.current} />);
  expect(marks()).toEqual([]);

  await act(() => docs.current.open('notes.md'));
  view.rerender(<Editor docs={docs.current} />);
  expect(marks()).toEqual(['Notes']);
});

test('clicking a label in the open post reports the passage it labels', async () => {
  const docs = await documents();
  docs.current.beginTurn();
  await act(() => docs.current.showHighlights({ file: 'notes.md', passages: [Q1] }));
  const onAsk = mock((_ask: Ask) => {});
  const view = render(<Editor docs={docs.current} onAsk={onAsk} />);

  fireEvent.click(view.container.querySelector('.ai-highlight-label')!);

  expect(onAsk.mock.calls.map(([ask]) => ask.passage)).toEqual([Q1]);
});
