import { expect, mock, spyOn, test } from 'bun:test';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PostSummary } from '../../../shared/wire';
import { PostList, type PostListDocs } from './post-list';

// The list over a stand-in for the documents hook: `posts` as listed, in the order given, and every call recorded.
function docsWith(posts: PostSummary[], more: Partial<PostListDocs> = {}): PostListDocs {
  return {
    posts,
    missing: [],
    current: undefined,
    finds: 0,
    newPosts: 0,
    label: (id) => posts.find((p) => p.id === id)?.title ?? id,
    isDirty: () => false,
    open: mock(async () => {}),
    createPost: mock(async () => 'new id'),
    rename: mock(async () => {}),
    remove: mock(async () => {}),
    ...more,
  };
}

async function renderList(docs: PostListDocs, busy = false) {
  const view = render(<PostList docs={docs} busy={busy} />);
  await act(async () => {});
  return view;
}

// The text of each row the list shows, top to bottom.
const rows = () =>
  within(screen.getByRole('list', { name: 'Posts' }))
    .getAllByRole('button')
    .filter((b) => b.classList.contains('name'))
    .map((b) => b.textContent);

test('lists posts by title, and posts that share a title by id', async () => {
  await renderList(docsWith([{ id: 'b', title: 'The Sun' }, { id: 'c', title: 'Moon' }, { id: 'a', title: 'The Sun' }]));
  expect(rows()).toEqual(['Moon', 'The Sun', 'The Sun']);
  expect(screen.getAllByRole('button', { name: /^Actions for/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
    'Actions for Moon',
    'Actions for The Sun',
    'Actions for The Sun',
  ]);
});

test('clicking a post opens it, and the open post and posts with unsaved changes are marked', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }, { id: '2/p 2', title: 'Sun' }], { current: '2/p 2', isDirty: (id) => id === '1/p 1' });
  await renderList(docs);
  expect(rows()).toEqual(['Moon (unsaved)', 'Sun']);
  expect(screen.getByRole('button', { name: 'Sun' }).closest('li')!.classList.contains('active')).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Moon (unsaved)' })));
  expect(docs.open).toHaveBeenCalledWith('1/p 1');
});

// Unsaved text can outlive its post: deleted elsewhere, or a draft from before posts had ids.
test('after the posts, lists each open post that is not in the list, saying so, and opens it on click', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }], { missing: ['the sun/draft.md'] });
  await renderList(docs);
  expect(rows()).toEqual(['Moon', 'the sun/draft.md — unsaved, not in your posts']);
  expect(screen.queryByRole('button', { name: 'Actions for the sun/draft.md' })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /not in your posts/ })));
  expect(docs.open).toHaveBeenCalledWith('the sun/draft.md');
});

// The dialog that is open, and a title typed into it.
const dialog = () => document.querySelector('dialog[open]') as HTMLDialogElement;
const typeTitle = (title: string) => fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Title' }), { target: { value: title } });
const submitButton = (name: string) => within(dialog()).getByRole('button', { name }) as HTMLButtonElement;

test('New post asks for a title, needs one that is not blank, makes the post, and opens it', async () => {
  const docs = docsWith([]);
  await renderList(docs);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New post' })));
  expect(within(dialog()).getByRole('heading').textContent).toBe('New post');
  expect(submitButton('Create').disabled).toBe(true);
  typeTitle('  ');
  expect(submitButton('Create').disabled).toBe(true);
  typeTitle('???');
  expect(submitButton('Create').disabled).toBe(false);
  await act(async () => fireEvent.submit(dialog().querySelector('form')!));
  expect(docs.createPost).toHaveBeenCalledWith('???');
  expect(docs.open).toHaveBeenCalledWith('new id');
  expect(document.querySelector('dialog[open]')).toBeNull();
});

// Titles need not be unique, so a second "The Sun" is made; the writer is told both will look the same.
test('New post warns, without refusing, when the title is one a post already has', async () => {
  await renderList(docsWith([{ id: '1/p 1', title: 'The Sun' }]));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New post' })));
  typeTitle(' The Sun ');
  expect(dialog().querySelector('.name-hint')!.textContent).toBe('You already have a post titled “The Sun”. Both will show as “The Sun” in the list.');
  expect(submitButton('Create').disabled).toBe(false);
  typeTitle('The Moon');
  expect(dialog().querySelector('.name-hint')!.textContent).toBe('');
});

const choose = (name: string) => act(async () => fireEvent.click(screen.getByRole('menuitem', { name })));

test('Rename changes only the title, which starts as the current one and must change and not be blank', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }, { id: '2/p 2', title: 'Sun' }]);
  await renderList(docs);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Moon' })));
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Rename', 'Delete']);
  await choose('Rename');
  expect(within(dialog()).getByRole('heading').textContent).toBe('Rename “Moon”');
  expect((within(dialog()).getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Moon');
  expect(dialog().querySelector('.name-hint')!.textContent).toBe('Only the name in the list changes. The post’s text, including any heading at the top, stays as it is.');
  expect(submitButton('Rename').disabled).toBe(true);
  typeTitle(' ');
  expect(submitButton('Rename').disabled).toBe(true);
  typeTitle('Sun');
  expect(dialog().querySelector('.name-hint')!.textContent).toBe('You already have a post titled “Sun”. Both will show as “Sun” in the list.');
  typeTitle('Moon / Night');
  await act(async () => fireEvent.submit(dialog().querySelector('form')!));
  expect(docs.rename).toHaveBeenCalledWith('1/p 1', 'Moon / Night');
});

// Delete removes the post's whole folder, side files the list never shows included, so the confirm says so.
test('Delete asks first, says the folder and its other files go for good, and warns of unsaved changes', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }, { id: '2/p 2', title: 'Sun' }], { isDirty: (id) => id === '2/p 2' });
  await renderList(docs);
  const confirmText = () => [...dialog().querySelectorAll('h3, p')].map((e) => e.textContent).filter(Boolean);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Moon' })));
  await choose('Delete');
  expect(confirmText()).toEqual(['Delete “Moon”?', 'This deletes the post’s folder on disk, with any other files in it, such as notes or outlines. You can’t undo this.']);
  expect(document.activeElement?.textContent).toBe('Cancel');
  await act(async () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' })));
  expect(docs.remove).not.toHaveBeenCalled();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Sun' })));
  await choose('Delete');
  expect(confirmText().at(-1)).toBe('Your unsaved changes to it will be lost too.');
  await act(async () => fireEvent.submit(dialog().querySelector('form')!));
  expect(docs.remove).toHaveBeenCalledWith('2/p 2');
  expect(document.querySelector('dialog[open]')).toBeNull();
});

// The AI's edits come back under the ids the turn began with, so the list holds still while it works.
test('while Claude works, posts still open but cannot be made, renamed, or deleted, and the list says why', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }]);
  const view = await renderList(docs);
  expect(screen.getByRole('status').textContent).toBe('');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Moon' })));
  view.rerender(<PostList docs={docs} busy={true} />);
  expect(screen.queryByRole('menu')).toBeNull();
  expect((screen.getByRole('button', { name: 'New post' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Actions for Moon' }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById('tree-paused')!.textContent).toBe('Changes to the post list are paused while Claude works. You can still open posts.');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Moon' })));
  expect(docs.open).toHaveBeenCalledWith('1/p 1');
});

// The empty editor's New post button and the header's "Show in the post list" reach the list through these counters.
test('opens New post when the page asks, unless Claude works, and scrolls the open post into view when asked to show it', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }, { id: '2/p 2', title: 'Sun' }], { current: '2/p 2' });
  const view = await renderList(docs);
  view.rerender(<PostList docs={{ ...docs, newPosts: 1 }} busy={true} />);
  expect(document.querySelector('dialog[open]')).toBeNull();
  view.rerender(<PostList docs={{ ...docs, newPosts: 2 }} busy={false} />);
  expect(within(dialog()).getByRole('heading').textContent).toBe('New post');

  const scrolled: string[] = [];
  const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    scrolled.push(this.textContent ?? '');
  });
  try {
    view.rerender(<PostList docs={{ ...docs, newPosts: 2, finds: 1 }} busy={false} />);
    await act(async () => {});
  } finally {
    scroll.mockRestore();
  }
  expect(scrolled).toEqual(['Sun']);
});

test('a post that will not open is reported above the list, and a create that fails keeps its dialog open saying why', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }], {
    open: mock(() => Promise.reject(new Error('That post no longer exists.'))),
    createPost: mock(() => Promise.reject(new Error('A post needs a title.'))),
  });
  await renderList(docs);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Moon' })));
  expect(screen.getByRole('alert').textContent).toBe('That post no longer exists.');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close error' })));
  expect(screen.queryByRole('alert')).toBeNull();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New post' })));
  typeTitle('Sun');
  await act(async () => fireEvent.submit(dialog().querySelector('form')!));
  expect(within(dialog()).getByRole('alert').textContent).toBe('A post needs a title.');
});

// Each dialog names itself by its heading and describes the title box by its hint. The ids come from useId, whose
// colons a `#id` selector cannot hold, so they are looked up by id.
test('each dialog is labelled by its heading, and the title box is described by its hint', async () => {
  await renderList(docsWith([{ id: '1/p 1', title: 'Moon' }]));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New post' })));
  expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)).toBe(dialog().querySelector('h3'));
  const title = within(dialog()).getByRole('textbox', { name: 'Title' });
  expect(document.getElementById(title.getAttribute('aria-describedby')!)).toBe(dialog().querySelector('.name-hint'));
  await act(async () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' })));

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Moon' })));
  await choose('Delete');
  expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)).toBe(dialog().querySelector('h3'));
});

test('a delete that fails says why in its dialog until closed, and the next dialog starts without it', async () => {
  const docs = docsWith([{ id: '1/p 1', title: 'Moon' }], { remove: mock(() => Promise.reject(new Error('The disk is full.'))) });
  await renderList(docs);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Moon' })));
  await choose('Delete');
  await act(async () => fireEvent.submit(dialog().querySelector('form')!));
  expect(within(dialog()).getByRole('alert').textContent).toBe('The disk is full.');
  await act(async () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Close error' })));
  expect(within(dialog()).queryByRole('alert')).toBeNull();
  await act(async () => fireEvent.submit(dialog().querySelector('form')!));
  await act(async () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' })));

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Moon' })));
  await choose('Rename');
  expect(within(dialog()).queryByRole('alert')).toBeNull();
});
