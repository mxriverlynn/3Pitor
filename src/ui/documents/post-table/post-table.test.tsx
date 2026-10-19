import { expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PostSummary } from '../../../shared/wire';
import { PostTable, type PostTableDocs } from './post-table';

// The table over a stand-in for the documents hook: `posts` as listed, newest first, and every call recorded. Its search
// matches titles only, which is all these tests need.
function docsWith(posts: PostSummary[], more: Partial<PostTableDocs> = {}): PostTableDocs {
  return {
    posts,
    isDirty: () => false,
    open: mock(async () => {}),
    search: mock(async (query: string) => posts.filter((p) => p.title.toLowerCase().includes(query.trim().toLowerCase())).map((p) => p.id)),
    requestNewPost: mock(() => {}),
    createPost: mock(async () => 'new id'),
    rename: mock(async () => {}),
    remove: mock(async () => {}),
    ...more,
  };
}

async function renderTable(docs: PostTableDocs, busy = false, onOpened = mock(() => {})) {
  const view = render(<PostTable docs={docs} busy={busy} onOpened={onOpened} />);
  await act(async () => {});
  return view;
}

const table = () => screen.getByRole('table', { name: 'Your posts' });
// The text of each title the table shows, top to bottom.
const titles = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent);

test('lists every post by title, and posts that share a title by id, each named for opening it', async () => {
  await renderTable(docsWith([{ id: 'b', title: 'The Sun' }, { id: 'c', title: 'Moon' }, { id: 'a', title: 'The Sun' }]));
  expect(screen.getByRole('heading', { name: 'Your posts' })).toBeTruthy();
  expect(titles()).toEqual(['Open Moon', 'Open The Sun', 'Open The Sun']);
  expect(screen.getAllByRole('button', { name: /^Open / }).length).toBe(3);
});

test('pressing Title flips the order, ties included, and its sort state and arrow follow', async () => {
  await renderTable(docsWith([{ id: 'b', title: 'The Sun' }, { id: 'c', title: 'Moon' }, { id: 'a', title: 'The Sun' }]));
  const header = () => within(table()).getAllByRole('columnheader')[0];
  const ids = () => within(table()).getAllByRole('button', { name: /^Open / }).map((b) => b.closest('tr')!.dataset.id);
  expect(header().getAttribute('aria-sort')).toBe('ascending');
  expect(ids()).toEqual(['c', 'a', 'b']);
  await act(async () => fireEvent.click(within(header()).getByRole('button', { name: 'Title' })));
  expect(header().getAttribute('aria-sort')).toBe('descending');
  expect(header().textContent).toBe('Title ▼');
  expect(ids()).toEqual(['b', 'a', 'c']);
  await act(async () => fireEvent.click(within(header()).getByRole('button', { name: 'Title' })));
  expect(header().getAttribute('aria-sort')).toBe('ascending');
  expect(header().textContent).toBe('Title ▲');
});

test('clicking a title opens its post, then says so, and posts with unsaved changes are marked', async () => {
  const onOpened = mock(() => {});
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }], { isDirty: () => true });
  await renderTable(docs, false, onOpened);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open Moon (unsaved)' })));
  expect(docs.open).toHaveBeenCalledWith('1/p 1');
  expect(onOpened).toHaveBeenCalledTimes(1);
});

test('a post that will not open is reported above the table until closed', async () => {
  const onOpened = mock(() => {});
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }], { open: mock(() => Promise.reject(new Error('That post no longer exists.'))) });
  await renderTable(docs, false, onOpened);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open Moon' })));
  expect(screen.getByRole('alert').textContent).toBe('That post no longer exists.');
  expect(onOpened).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close error' })));
  expect(screen.queryByRole('alert')).toBeNull();
});

const searchBox = () => screen.getByRole('searchbox', { name: 'Search posts' }) as HTMLInputElement;
const typeSearch = (text: string) => act(async () => fireEvent.change(searchBox(), { target: { value: text } }));
// Longer than the table waits after typing stops.
const pause = () => act(() => new Promise((resolve) => setTimeout(resolve, 300)));

test('the search box says what it searches, and searches once typing stops, with the last text typed', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }, { id: '2/p 2', title: 'Sun' }]);
  await renderTable(docs);
  expect(document.getElementById(searchBox().getAttribute('aria-describedby')!)!.textContent).toBe('Searches titles and saved text.');
  await typeSearch('s');
  await typeSearch('su');
  await typeSearch('sun ');
  await pause();
  expect(docs.search).toHaveBeenCalledTimes(1);
  expect(docs.search).toHaveBeenCalledWith('sun');
  expect(titles()).toEqual(['Open Sun']);
});

test('a blank search asks nothing and shows every post', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }, { id: '2/p 2', title: 'Sun' }]);
  await renderTable(docs);
  await typeSearch('sun');
  await pause();
  await typeSearch('  ');
  await pause();
  expect(docs.search).toHaveBeenCalledTimes(1);
  expect(titles()).toEqual(['Open Moon', 'Open Sun']);
});

test('New post asks the Posts list for a new post', async () => {
  const docs = docsWith([]);
  await renderTable(docs);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New post' })));
  expect(docs.requestNewPost).toHaveBeenCalledTimes(1);
});

// A search whose answers wait until each is let go, by the query it was asked.
function heldSearch() {
  const held = new Map<string, (ids: string[]) => void>();
  const search = mock((query: string) => new Promise<string[]>((resolve) => held.set(query, resolve)));
  const answer = (query: string, ids: string[]) => act(async () => held.get(query)!(ids));
  return { search, answer };
}

test('an earlier search that answers last does not replace the later one', async () => {
  const { search, answer } = heldSearch();
  await renderTable(docsWith([{ id: '1/p 1', title: 'Moon' }, { id: '2/p 2', title: 'Moonrise' }, { id: '3/p 3', title: 'Sun' }], { search }));
  await typeSearch('moon');
  await pause();
  await typeSearch('moonr');
  await pause();
  await answer('moonr', ['2/p 2']);
  await answer('moon', ['1/p 1', '2/p 2']);
  expect(titles()).toEqual(['Open Moonrise']);
});

test('a search that answers after the box is cleared does not filter the list', async () => {
  const { search, answer } = heldSearch();
  await renderTable(docsWith([{ id: '1/p 1', title: 'Moon' }, { id: '3/p 3', title: 'Sun' }], { search }));
  await typeSearch('moon');
  await pause();
  await typeSearch('');
  await answer('moon', ['1/p 1']);
  expect(titles()).toEqual(['Open Moon', 'Open Sun']);
});

test('a search that fails says why and keeps the rows it showed', async () => {
  const { search, answer } = heldSearch();
  let fail = false;
  const failing = mock((query: string) => (fail ? Promise.reject(new Error('The disk went away.')) : search(query)));
  await renderTable(docsWith([{ id: '1/p 1', title: 'Moon' }, { id: '2/p 2', title: 'Moonrise' }, { id: '3/p 3', title: 'Sun' }], { search: failing }));
  await typeSearch('moon');
  await pause();
  await answer('moon', ['1/p 1', '2/p 2']);
  fail = true;
  await typeSearch('moonr');
  await pause();
  expect(screen.getByRole('alert').textContent).toBe('Could not search your posts: The disk went away.');
  expect(titles()).toEqual(['Open Moon', 'Open Moonrise']);
});

test('the status line is empty while rows show, and says so when there are no posts or no matches', async () => {
  const view = await renderTable(docsWith([]));
  expect(screen.getByRole('status').textContent).toBe('No posts yet.');
  view.rerender(<PostTable docs={docsWith([{ id: '1/p 1', title: 'Moon' }])} busy={false} onOpened={() => {}} />);
  expect(screen.getByRole('status').textContent).toBe('');
  await typeSearch('  comet ');
  await pause();
  expect(screen.getByRole('status').textContent).toBe('No posts match “comet”.');
});

const actionsFor = (title: string) => screen.getByRole('button', { name: `More actions for “${title}”` }) as HTMLButtonElement;
const openMenu = (title: string) => act(async () => fireEvent.click(actionsFor(title)));
const choose = (name: string) => act(async () => fireEvent.click(screen.getByRole('menuitem', { name })));

test('a row’s actions offer Edit, Rename, and Delete, and Edit opens the post, then says so', async () => {
  const onOpened = mock(() => {});
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }]);
  await renderTable(docs, false, onOpened);
  expect(actionsFor('Moon').getAttribute('aria-expanded')).toBe('false');
  await openMenu('Moon');
  expect(actionsFor('Moon').getAttribute('aria-expanded')).toBe('true');
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Edit', 'Rename', 'Delete']);
  await choose('Edit');
  expect(docs.open).toHaveBeenCalledWith('1/p 1');
  expect(onOpened).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).toBeNull();
});

const dialog = () => document.querySelector('dialog[open]') as HTMLDialogElement;

test('Rename and Delete open their dialogs, and focus goes to the search box when each closes', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }]);
  await renderTable(docs);
  await openMenu('Moon');
  await choose('Rename');
  expect(within(dialog()).getByRole('heading').textContent).toBe('Rename “Moon”');
  fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Night' } });
  await act(async () => fireEvent.submit(dialog().querySelector('form')!));
  expect(docs.rename).toHaveBeenCalledWith('1/p 1', 'Night');
  expect(document.activeElement).toBe(searchBox());

  actionsFor('Moon').focus();
  await openMenu('Moon');
  await choose('Delete');
  expect(within(dialog()).getByRole('heading').textContent).toBe('Delete “Moon”?');
  await act(async () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' })));
  expect(docs.remove).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(searchBox());
});

test('Escape in a row’s menu puts focus back on its actions button, and tabbing out of the menu closes it', async () => {
  await renderTable(docsWith([{ id: '1/p 1', title: 'Moon' }]));
  await openMenu('Moon');
  await act(async () => fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Edit' }), { key: 'Escape' }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(actionsFor('Moon'));

  await openMenu('Moon');
  await act(async () => fireEvent.blur(screen.getByRole('menuitem', { name: 'Delete' }), { relatedTarget: searchBox() }));
  expect(screen.queryByRole('menu')).toBeNull();
});

// The AI's edits come back under the ids the turn began with, so posts are not made, renamed, or deleted while it works.
test('while Claude works, New post and the actions wait, saying why, an open menu closes to its title, and titles still open', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }]);
  const onOpened = mock(() => {});
  const view = await renderTable(docs, false, onOpened);
  await openMenu('Moon');
  view.rerender(<PostTable docs={docs} busy={true} onOpened={onOpened} />);
  await act(async () => {});
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open Moon' }));
  const newPost = screen.getByRole('button', { name: 'New post' }) as HTMLButtonElement;
  for (const button of [newPost, actionsFor('Moon')]) {
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe('tree-paused');
  }
  expect(searchBox().disabled).toBe(false);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open Moon' })));
  expect(docs.open).toHaveBeenCalledWith('1/p 1');
});
