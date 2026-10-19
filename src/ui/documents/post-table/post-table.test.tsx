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
