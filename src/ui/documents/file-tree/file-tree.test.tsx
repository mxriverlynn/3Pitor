import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { type FakeDocumentsApi, fakeDocumentsApi } from '../../components/fake-documents-api';
import { useDocuments } from '../documents/documents';
import { FileTree } from './file-tree';

const realFetch = globalThis.fetch;
let api: FakeDocumentsApi;
// While set, count requests wait for it to settle.
let countHeld: Promise<void> | undefined;

beforeEach(() => {
  api = fakeDocumentsApi({ 'notes.md': '# Notes\n', 'drafts/soil.md': '# Soil\n', 'drafts/2026/seeds.md': '# Seeds\n' }, ['archive']);
  countHeld = undefined;
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (url === '/api/documents/count') await countHeld;
    return (await api.handle(url, init))!;
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// The tree over the documents hook, as the page wires it; `docs` is the hook's latest value.
let docs: ReturnType<typeof useDocuments>;
function Tree({ busy = false }: { busy?: boolean }) {
  docs = useDocuments();
  return <FileTree docs={docs} busy={busy} />;
}

async function renderTree() {
  const view = render(<Tree />);
  await act(async () => {});
  return view;
}

// The names of the rows the tree shows, top to bottom.
const rows = () =>
  within(screen.getByRole('list', { name: 'Documents' }))
    .getAllByRole('button')
    .filter((b) => b.classList.contains('name'))
    .map((b) => b.textContent);

const click = (name: string) => act(async () => fireEvent.click(screen.getByRole('button', { name })));
const choose = (name: string) => act(async () => fireEvent.click(screen.getByRole('menuitem', { name })));
// The items of the menu that is open.
const menuItems = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((b) => b.textContent);
// The name dialog that is open, and a name typed into it.
const nameDialog = () => document.querySelector('dialog.name[open]') as HTMLDialogElement;
const typeName = (name: string) => fireEvent.change(within(nameDialog()).getByRole('textbox', { name: 'Name' }), { target: { value: name } });

test('shows folders before files, each folder collapsed until clicked', async () => {
  await renderTree();
  expect(rows()).toEqual(['archive', 'drafts', 'notes.md']);

  await click('drafts');

  expect(rows()).toEqual(['archive', 'drafts', '2026', 'soil.md', 'notes.md']);
  expect(screen.getByRole('button', { name: 'drafts' }).getAttribute('aria-expanded')).toBe('true');
  await click('drafts');
  expect(rows()).toEqual(['archive', 'drafts', 'notes.md']);
});

test('clicking a file opens it', async () => {
  await renderTree();
  await click('drafts');

  await click('soil.md');

  expect(docs.current).toBe('drafts/soil.md');
});

test('marks each file with unsaved changes, including a new post from the AI', async () => {
  await renderTree();
  await click('notes.md');
  docs.beginTurn();
  await act(async () => docs.applyEdited({ 'notes.md': '# Garden Notes\n', 'garden.md': '# Garden\n' }));

  expect(rows()).toEqual(['archive', 'drafts', 'garden.md (unsaved)', 'notes.md (unsaved)']);
});

test('opening a file that is gone from disk shows why above the tree, and opens nothing', async () => {
  await renderTree();
  api.files.delete('notes.md');

  await click('notes.md');

  expect(screen.getByRole('alert').textContent).toBe('notes.md was not found');
  expect(docs.current).toBeUndefined();
});

test('the + menu’s New file creates and opens a new file at the top level', async () => {
  await renderTree();
  const dialog = document.querySelector('dialog.name') as HTMLDialogElement;
  expect(dialog.open).toBe(false);

  await click('New file or folder');
  await choose('New file');
  expect(dialog.open).toBe(true);
  typeName('garden');
  await click('Create');

  expect(api.files.get('garden.md')).toBe('# garden\n');
  expect(docs.current).toBe('garden.md');
  expect(dialog.open).toBe(false);
  expect(rows()).toContain('garden.md');
});

test('creating a name that is taken is explained in the dialog, which stays open', async () => {
  await renderTree();
  const dialog = document.querySelector('dialog.name') as HTMLDialogElement;

  await click('New file or folder');
  await choose('New file');
  typeName('notes');
  await click('Create');

  expect(dialog.open).toBe(true);
  expect(within(dialog).getByRole('alert').textContent).toBe('notes.md already exists');
  expect(api.files.get('notes.md')).toBe('# Notes\n');
});

test('cancelling the new file dialog closes it without creating a file', async () => {
  await renderTree();
  const dialog = document.querySelector('dialog.name') as HTMLDialogElement;

  await click('New file or folder');
  await choose('New file');
  typeName('garden');
  await click('Cancel');

  expect(dialog.open).toBe(false);
  expect(api.files.has('garden.md')).toBe(false);
});

test('never puts a button inside another button', async () => {
  const view = await renderTree();
  await click('drafts');
  await click('2026');

  expect(view.container.querySelectorAll('button button')).toHaveLength(0);
});

test('the + menu offers a new file or a new folder, and a new folder shows in the tree', async () => {
  await renderTree();

  await click('New file or folder');
  expect(menuItems()).toEqual(['New file', 'New folder']);
  await choose('New folder');
  typeName('essays');
  await click('Create');

  expect(api.folders.has('essays')).toBe(true);
  expect(rows()).toEqual(['archive', 'drafts', 'essays', 'notes.md']);
  expect(screen.queryByRole('menu')).toBeNull();
});

test('a folder’s ... menu creates inside it, and the new file opens with its folder expanded', async () => {
  await renderTree();

  await click('Actions for drafts');
  await choose('New file');
  typeName('compost');
  await click('Create');

  expect(api.files.get('drafts/compost.md')).toBe('# compost\n');
  expect(docs.current).toBe('drafts/compost.md');
  expect(rows()).toEqual(['archive', 'drafts', '2026', 'compost.md', 'soil.md', 'notes.md']);
});

test('the name dialog will not submit an empty name, or one holding a /', async () => {
  await renderTree();
  await click('New file or folder');
  await choose('New file');
  const create = () => within(nameDialog()).getByRole('button', { name: 'Create' }) as HTMLButtonElement;

  expect(create().disabled).toBe(true);
  typeName('  ');
  expect(create().disabled).toBe(true);
  typeName('drafts/compost');
  expect(create().disabled).toBe(true);
  typeName('compost');
  expect(create().disabled).toBe(false);
});

test('a menu closes on Escape, and on a press outside it', async () => {
  await renderTree();

  await click('Actions for drafts');
  await act(async () => fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' }));
  expect(screen.queryByRole('menu')).toBeNull();

  await click('Actions for drafts');
  await act(async () => fireEvent.pointerDown(document.body));
  expect(screen.queryByRole('menu')).toBeNull();
});

test('a post the AI wrote that is not saved yet, and the folder it implies, offer no actions', async () => {
  await renderTree();
  docs.beginTurn();
  await act(async () => docs.applyEdited({ 'essays/idea.md': '# Idea\n' }));

  expect(screen.queryByRole('button', { name: 'Actions for essays' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Actions for drafts' })).toBeTruthy();
});

test('a file’s ... menu renames it, and it stays open under its new name', async () => {
  await renderTree();
  await click('notes.md');

  await click('Actions for notes.md');
  expect(menuItems()).toEqual(['Rename', 'Move to…', 'Delete']);
  await choose('Rename');
  expect((within(nameDialog()).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('notes.md');
  typeName('garden');
  await click('Rename');

  expect(api.files.get('garden.md')).toBe('# Notes\n');
  expect(docs.current).toBe('garden.md');
  expect(rows()).toEqual(['archive', 'drafts', 'garden.md']);
});

test('renaming an expanded folder keeps it expanded', async () => {
  await renderTree();
  await click('drafts');

  await click('Actions for drafts');
  expect(menuItems()).toEqual(['New file', 'New folder', 'Rename', 'Move to…', 'Delete']);
  await choose('Rename');
  typeName('essays');
  await click('Rename');

  expect(rows()).toEqual(['archive', 'essays', '2026', 'soil.md', 'notes.md']);
});

test('a rename the server refuses is explained in the dialog, which stays open', async () => {
  await renderTree();

  await click('Actions for drafts');
  await choose('Rename');
  typeName('archive');
  await click('Rename');

  expect(within(nameDialog()).getByRole('alert').textContent).toBe('archive already exists');
});

// The delete confirmation that is open.
const deleteDialog = () => document.querySelector('dialog.confirm[open]') as HTMLDialogElement;
const deleteButton = () => within(deleteDialog()).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;

test('deleting a file asks first, then removes it', async () => {
  await renderTree();

  await click('Actions for notes.md');
  await choose('Delete');
  expect(deleteDialog().textContent).toContain('Delete notes.md?');
  expect(document.activeElement?.textContent).toBe('Cancel');
  await act(async () => fireEvent.click(deleteButton()));

  expect(api.files.has('notes.md')).toBe(false);
  expect(rows()).toEqual(['archive', 'drafts']);
  expect(deleteDialog()).toBeNull();
});

test('deleting a folder waits for its count, then says exactly what goes', async () => {
  api.files.set('drafts/cover.md', '# Cover\n');
  let release!: () => void;
  countHeld = new Promise((resolve) => (release = resolve));
  await renderTree();

  await click('Actions for drafts');
  await choose('Delete');
  expect(deleteButton().disabled).toBe(true);
  await act(async () => release());

  expect(deleteDialog().textContent).toContain('Delete drafts and everything in it: 3 files and 1 sub-folder?');
  expect(deleteButton().disabled).toBe(false);
});

test('a count of one reads in the singular', async () => {
  await renderTree();
  await click('drafts');

  await click('Actions for drafts/2026');
  await choose('Delete');

  expect(deleteDialog().textContent).toContain('Delete drafts/2026 and everything in it: 1 file and 0 sub-folders?');
});

test('deleting a folder names the unsaved edits it throws away, and they are gone afterward', async () => {
  await renderTree();
  await click('drafts');
  await click('soil.md');
  docs.beginTurn();
  await act(async () => docs.applyEdited({ 'drafts/soil.md': '# Rich Soil\n' }));

  await click('Actions for drafts');
  await choose('Delete');
  expect(deleteDialog().textContent).toContain('Unsaved changes in drafts/soil.md will be lost.');
  await act(async () => fireEvent.click(deleteButton()));

  expect(docs.current).toBeUndefined();
  expect(docs.dirtyWithin('drafts')).toEqual([]);
  expect(rows()).toEqual(['archive', 'notes.md']);
});

test('cancelling a delete leaves everything as it was', async () => {
  await renderTree();

  await click('Actions for drafts');
  await choose('Delete');
  await act(async () => fireEvent.click(within(deleteDialog()).getByRole('button', { name: 'Cancel' })));

  expect(deleteDialog()).toBeNull();
  expect(api.files.has('drafts/soil.md')).toBe(true);
  expect(rows()).toEqual(['archive', 'drafts', 'notes.md']);
});

test('a folder that cannot be counted says why, and cannot be deleted', async () => {
  await renderTree();
  api.folders.delete('archive');

  await click('Actions for archive');
  await choose('Delete');

  expect(within(deleteDialog()).getByRole('alert').textContent).toBe('archive was not found');
  expect(deleteButton().disabled).toBe(true);
});

// The move dialog that is open, and the destinations it offers.
const moveDialog = () => document.querySelector('dialog.move[open]') as HTMLDialogElement;
const destinations = () =>
  within(moveDialog())
    .getAllByRole('button')
    .filter((b) => b.textContent !== 'Cancel')
    .map((b) => b.textContent);

test('Move to… offers the top level and every folder, but not the item, what is inside it, or where it already is', async () => {
  api.folders.add('drafts/2026/spring');
  await renderTree();
  await click('drafts');

  await click('Actions for drafts/2026');
  await choose('Move to…');

  expect(destinations()).toEqual(['Documents (top level)', 'archive']);
});

test('Move to… moves the item to the folder chosen, and back to the top level, with focus landing in the menu', async () => {
  await renderTree();

  await click('Actions for notes.md');
  await choose('Move to…');
  await act(async () => fireEvent.click(within(moveDialog()).getByRole('button', { name: 'archive' })));
  expect(api.files.has('archive/notes.md')).toBe(true);
  expect(moveDialog()).toBeNull();

  await click('archive');
  await click('Actions for archive/notes.md');
  expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
  await choose('Move to…');
  const top = within(moveDialog()).getByRole('button', { name: 'Documents (top level)' });
  await act(async () => fireEvent.click(top));

  expect(api.files.has('notes.md')).toBe(true);
});

test('a move the server refuses is explained in the move dialog, which stays open', async () => {
  api.files.set('archive/notes.md', '# Old Notes\n');
  await renderTree();

  await click('Actions for notes.md');
  await choose('Move to…');
  await act(async () => fireEvent.click(within(moveDialog()).getByRole('button', { name: 'archive' })));

  expect(within(moveDialog()).getByRole('alert').textContent).toBe('archive/notes.md already exists');
});

// Drag events carry a stand-in for the browser's DataTransfer, which the tree only writes to.
const dataTransfer = { setData: () => {}, getData: () => '', effectAllowed: 'all', dropEffect: 'none' };
const rowOf = (name: string) => screen.getByRole('button', { name }).closest('li')!;
const heading = () => screen.getByRole('heading', { name: 'Documents' });
const dragStart = (name: string) => act(async () => void fireEvent.dragStart(rowOf(name), { dataTransfer }));
// Whether the element accepts the drag hovering over it: a drop target cancels dragover.
const accepts = (element: Element) => {
  let accepted = false;
  act(() => void (accepted = !fireEvent.dragOver(element, { dataTransfer })));
  return accepted;
};
const drop = (element: Element) => act(async () => void fireEvent.drop(element, { dataTransfer }));
const moves = () => api.requests.filter((r) => r === 'POST /api/documents/move');

test('dragging a file onto a folder moves it there', async () => {
  await renderTree();

  await dragStart('notes.md');
  expect(accepts(rowOf('drafts'))).toBe(true);
  expect(rowOf('drafts').classList.contains('drop')).toBe(true);
  await drop(rowOf('drafts'));

  expect(api.files.has('drafts/notes.md')).toBe(true);
  expect(rows()).toEqual(['archive', 'drafts']);
});

test('a folder cannot be dropped onto itself or into its own sub-folder, and dropping on its own parent does nothing', async () => {
  await renderTree();
  await click('drafts');

  await dragStart('drafts');
  expect(accepts(rowOf('drafts'))).toBe(false);
  expect(accepts(rowOf('2026'))).toBe(false);
  await drop(rowOf('drafts'));
  await drop(rowOf('2026'));
  await dragStart('2026');
  await drop(rowOf('drafts'));

  expect(moves()).toEqual([]);
});

test('dropping on the Documents heading moves an item to the top level', async () => {
  await renderTree();
  await click('drafts');

  await dragStart('soil.md');
  expect(accepts(heading())).toBe(true);
  await drop(heading());

  expect(api.files.has('soil.md')).toBe(true);
});

test('a drop the server refuses is shown above the tree', async () => {
  api.files.set('archive/notes.md', '# Old Notes\n');
  await renderTree();

  await dragStart('notes.md');
  await drop(rowOf('archive'));

  expect(screen.getByRole('alert').textContent).toBe('archive/notes.md already exists');
});

test('nothing can be dragged while the AI works, nor a post that is not saved yet', async () => {
  const view = render(<Tree busy />);
  await act(async () => {});
  // happy-dom has no `draggable` property; React sets the attribute.
  const draggable = (name: string) => rowOf(name).getAttribute('draggable');
  expect(draggable('notes.md')).toBe('false');

  view.rerender(<Tree />);
  docs.beginTurn();
  await act(async () => docs.applyEdited({ 'garden.md': '# Garden\n' }));
  expect(draggable('notes.md')).toBe('true');
  expect(draggable('garden.md (unsaved)')).toBe('false');
});

test('each row shows an icon for what it is, a folder’s showing whether it is open, and folders are marked apart', async () => {
  await renderTree();
  await click('drafts');
  const icon = (name: string) => screen.getByRole('button', { name }).querySelector('svg.icon');

  expect([icon('archive')?.getAttribute('class'), icon('drafts')?.getAttribute('class'), icon('notes.md')?.getAttribute('class')]).toEqual([
    'icon folder',
    'icon folder open',
    'icon file',
  ]);
  expect(icon('notes.md')?.getAttribute('aria-hidden')).toBe('true');
  expect([rowOf('drafts').classList.contains('folder'), rowOf('notes.md').classList.contains('folder')]).toEqual([true, false]);
});
