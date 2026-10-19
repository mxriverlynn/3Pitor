import { expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { documentKey } from '../../../shared/document-key';
import type { PostSummary } from '../../../shared/wire';
import { PostPanel, type PostPanelDocs } from './post-panel';

const MOON = '1/p 1';
const SUN = '2/p 2';
const posts: PostSummary[] = [
  { id: MOON, title: 'Moon' },
  { id: SUN, title: 'Sun' },
];
const outline = (postId: string) => documentKey({ kind: 'outline', postId });
const research = (postId: string, researchDocumentId: string) => documentKey({ kind: 'research', postId, researchDocumentId });

// The panel over a stand-in for the documents hook, with Moon open and no documents listed for it, unless `more` says
// otherwise. Labels follow the hook's: a post's title, "Outline: <post>", "Research: <title>".
function docsWith(more: Partial<PostPanelDocs> = {}): PostPanelDocs {
  const docs: PostPanelDocs = {
    posts,
    current: MOON,
    postDocs: { postId: MOON, outline: false, researchDocuments: [] },
    missing: [],
    label: (key) => {
      const ref = key.startsWith('.') ? JSON.parse(key.slice(1)) : ['post', key];
      if (ref[0] === 'outline') return `Outline: ${docs.label(ref[1])}`;
      if (ref[0] === 'research') return `Research: ${docs.postDocs?.researchDocuments.find((d) => d.id === ref[2])?.title ?? ref[2]}`;
      return posts.find((post) => post.id === key)?.title ?? key;
    },
    isListed: (id) => posts.some((post) => post.id === id),
    isDirty: () => false,
    isPostDirty: () => false,
    open: mock(async () => {}),
    createPost: mock(async () => 'new id'),
    rename: mock(async () => {}),
    remove: mock(async () => {}),
    removeDocument: mock(async () => {}),
    ...more,
  };
  return docs;
}

async function renderPanel(docs: PostPanelDocs, busy = false) {
  const view = render(<PostPanel docs={docs} busy={busy} />);
  await act(async () => {});
  return view;
}

// The panel is a landmark named Post Content, so it stands apart from the Content Outline box beside it.
const panel = () => screen.getByRole('complementary', { name: 'Post Content' });
// The text of each document button the panel shows, top to bottom, the post's heading first.
const names = () => [...panel().querySelectorAll('button.name')].map((b) => b.textContent);
const dialog = () => document.querySelector('dialog[open]') as HTMLDialogElement;
const choose = (name: string) => act(async () => fireEvent.click(screen.getByRole('menuitem', { name })));

test('with nothing open, the panel is the Post Content landmark, headed Post Content, says to pick a post, and keeps the paused line in the page', async () => {
  await renderPanel(docsWith({ current: undefined, postDocs: undefined }));
  expect(within(panel()).getByRole('heading', { level: 2 }).textContent).toBe('Post Content');
  expect(panel().textContent).toContain('No post open. Pick one from your posts.');
  expect(names()).toEqual([]);
  expect(document.getElementById('tree-paused')).toBeTruthy();
});

test('with a post open, its draft heads the panel, with its outline and its research by title beneath', async () => {
  const docs = docsWith({
    postDocs: { postId: MOON, outline: true, researchDocuments: [{ id: 'z', title: 'Tides' }, { id: 'a', title: 'Craters' }] },
  });
  await renderPanel(docs);
  expect(within(screen.getByRole('heading', { level: 3 })).getByRole('button').textContent).toBe('Draft');
  expect(names()).toEqual(['Draft', 'Draft Outline', 'Craters', 'Tides']);
  expect(screen.getByRole('heading', { name: 'Research' })).toBeTruthy();
  expect(panel().textContent).not.toContain('appear here');
  expect(screen.getByRole('button', { name: 'Draft' }).getAttribute('aria-current')).toBe('true');
  expect(screen.getByRole('button', { name: 'Draft Outline' }).hasAttribute('aria-current')).toBe(false);

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Draft Outline' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Craters' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Draft' })));
  expect((docs.open as ReturnType<typeof mock>).mock.calls).toEqual([[outline(MOON)], [research(MOON, 'a')], [MOON]]);
});

test('a post with neither an outline nor research says where they will appear', async () => {
  await renderPanel(docsWith());
  expect(names()).toEqual(['Draft']);
  expect(panel().textContent).toContain('Research and an outline for this post appear here.');
  expect(screen.queryByRole('heading', { name: 'Research' })).toBeNull();
});

test('the open document is marked current and active, and documents with unsaved changes say so', async () => {
  const docs = docsWith({
    current: research(MOON, 'a'),
    postDocs: { postId: MOON, outline: false, researchDocuments: [{ id: 'a', title: 'Craters' }] },
    isDirty: (key) => key === outline(MOON) || key === MOON,
  });
  await renderPanel(docs);
  // An unsaved outline the post does not have yet still shows, so its changes can be reached.
  expect(names()).toEqual(['Draft (unsaved)', 'Draft Outline (unsaved)', 'Craters']);
  const craters = screen.getByRole('button', { name: 'Craters' });
  expect(craters.getAttribute('aria-current')).toBe('true');
  expect(craters.closest('.row')!.classList.contains('active')).toBe(true);
  expect(screen.getByRole('button', { name: 'Draft (unsaved)' }).hasAttribute('aria-current')).toBe(false);
});

// Unsaved text can outlive its post or its research document.
test('open documents with unsaved changes whose post or research document is gone are listed last, saying so', async () => {
  const docs = docsWith({ missing: ['the sun/draft.md', research(MOON, 'gone'), outline('gone post')] });
  await renderPanel(docs);
  expect(names()).toEqual([
    'Draft',
    'the sun/draft.md — unsaved, not in your posts',
    'Research: gone — unsaved, no longer in its post',
    'Outline: gone post — unsaved, not in your posts',
  ]);
  expect(screen.queryByRole('button', { name: /^Actions for the sun/ })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /no longer in its post/ })));
  expect(docs.open).toHaveBeenCalledWith(research(MOON, 'gone'));
});

test('an open post that is not in your posts heads the panel by its id, saying so, with no actions', async () => {
  await renderPanel(docsWith({ current: 'the sun/draft.md', postDocs: undefined, missing: ['the sun/draft.md'] }));
  expect(names()).toEqual(['the sun/draft.md — unsaved, not in your posts']);
  expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
});

test('each row’s actions follow its name, so Tab reaches them, and the outline has none', async () => {
  await renderPanel(docsWith({ postDocs: { postId: MOON, outline: true, researchDocuments: [{ id: 'a', title: 'Craters' }] } }));
  // The post's row reads Draft, but its actions still name the post.
  for (const [name, title] of [['Draft', 'Moon'], ['Craters', 'Craters']]) {
    const button = screen.getByRole('button', { name });
    const actions = screen.getByRole('button', { name: `Actions for ${title}` });
    expect(button.closest('.row')).toBe(actions.closest('.row'));
    expect(button.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(screen.queryByRole('button', { name: 'Actions for Draft Outline' })).toBeNull();
});

test('Rename and Delete of the open post ask first, with the post dialogs', async () => {
  const docs = docsWith({ isPostDirty: () => true });
  await renderPanel(docs);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Moon' })));
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Rename', 'Delete']);
  await choose('Rename');
  expect(within(dialog()).getByRole('heading').textContent).toBe('Rename “Moon”');
  fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Moon / Night' } });
  await act(async () => fireEvent.submit(dialog().querySelector('form')!));
  expect(docs.rename).toHaveBeenCalledWith(MOON, 'Moon / Night');

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Moon' })));
  await choose('Delete');
  expect([...dialog().querySelectorAll('h3, p')].map((e) => e.textContent).at(-1)).toBe('Your unsaved changes to it will be lost too.');
  await act(async () => fireEvent.submit(dialog().querySelector('form')!));
  expect(docs.remove).toHaveBeenCalledWith(MOON);
});

test('a research document’s Delete asks first, warns of unsaved changes, and deletes it', async () => {
  const docs = docsWith({
    postDocs: { postId: MOON, outline: false, researchDocuments: [{ id: 'a', title: 'Craters' }] },
    isDirty: (key) => key === research(MOON, 'a'),
  });
  await renderPanel(docs);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Craters' })));
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Delete']);
  await choose('Delete');
  const asking = screen.getByRole('dialog', { name: 'Delete “Research: Craters”?' });
  expect(asking.querySelector('p')!.textContent).toBe('You can’t undo this. Your unsaved changes to it will be lost too.');
  await act(async () => fireEvent.click(within(asking).getByRole('button', { name: 'Cancel' })));
  expect(docs.removeDocument).not.toHaveBeenCalled();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Craters' })));
  await choose('Delete');
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })));
  expect(docs.removeDocument).toHaveBeenCalledWith(research(MOON, 'a'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

// The AI's edits come back under the keys the turn began with, so nothing is renamed or deleted while it works.
test('while Claude works, every menu waits, an open one closes to its row, and the panel says what is paused', async () => {
  const docs = docsWith({ postDocs: { postId: MOON, outline: false, researchDocuments: [{ id: 'a', title: 'Craters' }] } });
  const view = await renderPanel(docs);
  expect(document.getElementById('tree-paused')!.textContent).toBe('');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Craters' })));
  view.rerender(<PostPanel docs={docs} busy={true} />);
  await act(async () => {});
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Craters' }));
  for (const name of ['Actions for Moon', 'Actions for Craters']) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  }
  expect(document.getElementById('tree-paused')!.textContent).toBe(
    'Renaming and deleting are paused while Claude works. You can still open, edit, and save.',
  );
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Craters' })));
  expect(docs.open).toHaveBeenCalledWith(research(MOON, 'a'));
});

test('a document that will not open, or a research Delete that fails, is reported above the panel until closed', async () => {
  const docs = docsWith({
    postDocs: { postId: MOON, outline: true, researchDocuments: [{ id: 'a', title: 'Craters' }] },
    open: mock(() => Promise.reject(new Error('That post no longer exists.'))),
    removeDocument: mock(() => Promise.reject(new Error('That research document no longer exists.'))),
  });
  await renderPanel(docs);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Draft Outline' })));
  expect(screen.getByRole('alert').textContent).toBe('That post no longer exists.');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close error' })));
  expect(screen.queryByRole('alert')).toBeNull();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Craters' })));
  await choose('Delete');
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })));
  expect(screen.getByRole('alert').textContent).toBe('That research document no longer exists.');
});

test('a delete of the post that fails says why in its dialog until closed', async () => {
  const docs = docsWith({ remove: mock(() => Promise.reject(new Error('The disk is full.'))) });
  await renderPanel(docs);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Actions for Moon' })));
  await choose('Delete');
  await act(async () => fireEvent.submit(dialog().querySelector('form')!));
  expect(within(dialog()).getByRole('alert').textContent).toBe('The disk is full.');
  expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)).toBe(dialog().querySelector('h3'));
});
