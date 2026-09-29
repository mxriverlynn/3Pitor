import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import { Editor, useDocuments } from './documents';
import { type Ask, markdownOf } from '../markdown-editor/markdown-editor';
import { type FakeDocumentsApi, fakeDocumentsApi } from '../../components/fake-documents-api';

const realFetch = globalThis.fetch;
let api: FakeDocumentsApi;
// The workspace's files, as the documents routes would read and write them.
let disk: Map<string, string>;
// When set, every save is refused with this sentence.
let refuseSaves: string | undefined;

beforeEach(() => {
  api = fakeDocumentsApi({ 'notes.md': '# Notes\n', 'ideas.md': '# Ideas\n' });
  disk = api.files;
  refuseSaves = undefined;
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (refuseSaves && init?.method === 'PUT') return Response.json({ error: refuseSaves }, { status: 400 });
    return (await api.handle(url, init))!;
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

// The hook with notes.md open, as if the writer had clicked it.
async function withNotesOpen() {
  const docs = await documents();
  await act(() => docs.current.open('notes.md'));
  return docs;
}

test('nothing opens when the page loads: the editor asks for a file, and no document is fetched', async () => {
  const docs = await documents();

  render(<Editor docs={docs.current} />);

  expect(docs.current.current).toBeUndefined();
  expect(screen.getByText('Select a file')).toBeTruthy();
  expect(api.requests).toEqual(['GET /api/documents']);
});

test('switching files keeps the unsaved text of the file left behind', async () => {
  const docs = await withNotesOpen();
  await act(async () => typeInto(docs.current.doc!, ' for today'));

  await act(() => docs.current.open('ideas.md'));
  await act(() => docs.current.open('notes.md'));

  expect(markdownOf(docs.current.doc!)).toBe('# Notes for today');
  expect(docs.current.dirty).toBe(true);
});

test('saving one file leaves the other files unsaved', async () => {
  const docs = await withNotesOpen();
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
  const docs = await withNotesOpen();
  expect(leavingWarns()).toBe(false);

  await act(async () => typeInto(docs.current.doc!, ' for today'));
  await act(() => docs.current.open('ideas.md'));
  expect(leavingWarns()).toBe(true);

  await act(() => docs.current.save('notes.md'));
  expect(leavingWarns()).toBe(false);
});

test('a save the server refuses is shown in the editor, and the file stays unsaved', async () => {
  const docs = await withNotesOpen();
  await act(async () => typeInto(docs.current.doc!, ' for today'));
  const view = render(<Editor docs={docs.current} />);
  refuseSaves = 'the disk is full';

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
  view.rerender(<Editor docs={docs.current} />);

  expect(screen.getByRole('alert').textContent).toBe('Could not save notes.md: the disk is full');
  expect(docs.current.dirty).toBe(true);
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
  const docs = await withNotesOpen();
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
  const docs = await withNotesOpen();
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
  expect(docs.current.listed).toContainEqual({ path: 'garden.md', kind: 'file', onDisk: false });

  await act(() => docs.current.save('garden.md'));

  expect(disk.get('garden.md')).toBe('# Garden');
  expect(docs.current.entries).toContainEqual({ path: 'garden.md', kind: 'file' });
});

test('the list holds what is on disk, plus posts the AI wrote that are not saved yet and the folders they imply', async () => {
  api = fakeDocumentsApi({ 'notes.md': '# Notes\n' }, ['drafts']);
  const docs = await documents();
  docs.current.beginTurn();

  await act(async () => docs.current.applyEdited({ 'drafts/new/idea.md': '# Idea\n' }));

  expect(docs.current.listed).toEqual([
    { path: 'drafts', kind: 'folder', onDisk: true },
    { path: 'drafts/new', kind: 'folder', onDisk: false },
    { path: 'drafts/new/idea.md', kind: 'file', onDisk: false },
    { path: 'notes.md', kind: 'file', onDisk: true },
  ]);
});

test('creating a folder lists it, and creating a file lists it and opens it', async () => {
  const docs = await documents();

  await act(() => docs.current.createEntry('drafts', 'folder'));
  expect(docs.current.entries).toContainEqual({ path: 'drafts', kind: 'folder' });
  expect(docs.current.current).toBeUndefined();

  await act(() => docs.current.createEntry('drafts/soil.md', 'file'));
  expect(docs.current.entries).toContainEqual({ path: 'drafts/soil.md', kind: 'file' });
  expect(docs.current.current).toBe('drafts/soil.md');
  expect(markdownOf(docs.current.doc!)).toBe('# soil');
});

test('creating a path that is taken rejects with why, and leaves the file as it was', async () => {
  const docs = await documents();

  await expect(docs.current.createEntry('notes.md', 'file')).rejects.toThrow('notes.md already exists');
  expect(disk.get('notes.md')).toBe('# Notes\n');
});

test('renaming a file keeps its unsaved edits under the new name, and Save writes only the new path', async () => {
  const docs = await withNotesOpen();
  await act(async () => typeInto(docs.current.doc!, ' for today'));

  await act(() => docs.current.move('notes.md', 'garden.md'));

  expect(docs.current.current).toBe('garden.md');
  expect(docs.current.dirty).toBe(true);
  expect(markdownOf(docs.current.doc!)).toBe('# Notes for today');
  await act(() => docs.current.save());
  expect(api.files.get('garden.md')).toBe('# Notes for today');
  expect(api.files.has('notes.md')).toBe(false);
});

test('renaming a folder re-files every open file inside it, its highlights too, and leaves a look-alike name alone', async () => {
  api = fakeDocumentsApi({ 'drafts/soil.md': '# Soil\n', 'drafts/2026/seeds.md': '# Seeds\n', 'drafts-old.md': '# Old\n' });
  const docs = await documents();
  await act(() => docs.current.open('drafts/2026/seeds.md'));
  await act(async () => typeInto(docs.current.doc!, ' saved'));
  await act(() => docs.current.open('drafts-old.md'));
  await act(() => docs.current.open('drafts/soil.md'));
  docs.current.beginTurn();
  await act(() => docs.current.showHighlights({ file: 'drafts/soil.md', passages: [{ quote: 'Soil' }] }));

  await act(() => docs.current.move('drafts', 'essays'));

  expect(docs.current.current).toBe('essays/soil.md');
  expect(docs.current.highlights).toEqual([{ quote: 'Soil' }]);
  expect(docs.current.isDirty('essays/2026/seeds.md')).toBe(true);
  expect(docs.current.listed.map((e) => e.path)).toEqual(['drafts-old.md', 'essays', 'essays/2026', 'essays/2026/seeds.md', 'essays/soil.md']);
  expect(docs.current.beginTurn().documents).toEqual({
    'essays/2026/seeds.md': '# Seeds saved',
    'drafts-old.md': '# Old',
    'essays/soil.md': '# Soil',
  });
});

test('a rename the server refuses changes nothing in the browser', async () => {
  const docs = await withNotesOpen();
  await act(async () => typeInto(docs.current.doc!, ' for today'));

  await act(() => expect(docs.current.move('notes.md', 'ideas.md')).rejects.toThrow('ideas.md already exists'));

  expect(docs.current.current).toBe('notes.md');
  expect(docs.current.isDirty('notes.md')).toBe(true);
  expect(markdownOf(docs.current.doc!)).toBe('# Notes for today');
});

test('deleting a folder drops every open file inside it, unsaved edits and all, and closes the one on show', async () => {
  api = fakeDocumentsApi({ 'drafts/soil.md': '# Soil\n', 'drafts/2026/seeds.md': '# Seeds\n', 'drafts-old.md': '# Old\n' });
  const docs = await documents();
  await act(() => docs.current.open('drafts-old.md'));
  await act(() => docs.current.open('drafts/2026/seeds.md'));
  await act(async () => typeInto(docs.current.doc!, ' saved'));
  await act(() => docs.current.open('drafts/soil.md'));
  expect(await docs.current.countContents('drafts')).toEqual({ files: 2, folders: 1 });
  expect(docs.current.dirtyWithin('drafts')).toEqual(['drafts/2026/seeds.md']);

  await act(() => docs.current.remove('drafts'));

  expect(docs.current.current).toBeUndefined();
  expect(docs.current.listed.map((e) => e.path)).toEqual(['drafts-old.md']);
  expect(docs.current.dirtyWithin('drafts')).toEqual([]);
  expect(Object.keys(docs.current.beginTurn().documents)).toEqual(['drafts-old.md']);
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

test('saving the post clears the highlights that last until it is saved', async () => {
  const docs = await withNotesOpen();
  docs.current.beginTurn();
  await act(() => docs.current.showHighlights({ file: 'notes.md', passages: [{ quote: 'Notes' }], untilSaved: true }));
  await act(async () => typeInto(docs.current.doc!, ' for today'));

  await act(() => docs.current.save('notes.md'));

  expect(docs.current.highlights).toEqual([]);
});

test('saving another post leaves the highlights that last until this post is saved', async () => {
  const docs = await withNotesOpen();
  await act(() => docs.current.open('ideas.md'));
  await act(async () => typeInto(docs.current.doc!, ' to try'));
  await act(() => docs.current.open('notes.md'));
  docs.current.beginTurn();
  const passages = [{ quote: 'Notes' }];
  await act(() => docs.current.showHighlights({ file: 'notes.md', passages, untilSaved: true }));

  await act(() => docs.current.save('ideas.md'));

  expect(docs.current.highlights).toEqual(passages);
});

test('highlights of a post not yet open load it from disk, and keep the edits that could not be applied', async () => {
  disk.set('plan.md', '# Plan\n');
  const docs = await withNotesOpen();
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
