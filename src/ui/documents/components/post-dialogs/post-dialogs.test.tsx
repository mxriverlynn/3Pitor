import { expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PostSummary } from '../../../../shared/wire';
import { usePostDialogs, type PostDialogsDocs } from './post-dialogs';

const moon: PostSummary = { id: '1/p 1', title: 'Moon' };

function docsWith(more: Partial<PostDialogsDocs> = {}): PostDialogsDocs {
  return {
    posts: [moon],
    isPostDirty: () => false,
    createPost: mock(async () => 'new id'),
    rename: mock(async () => {}),
    remove: mock(async () => {}),
    ...more,
  };
}

// One caller of the dialogs: a button for each, named after `name`.
function Caller({ name, docs, onClose, busy }: { name: string; docs: PostDialogsDocs; onClose?: () => void; busy?: boolean }) {
  const { askNewPost, askRename, askDelete, dialogs } = usePostDialogs(docs, () => {}, { onClose, busy });
  return (
    <div>
      <button onClick={askNewPost}>{name} new</button>
      <button onClick={() => askRename(moon)}>{name} rename</button>
      <button onClick={() => askDelete(moon)}>{name} delete</button>
      {dialogs}
    </div>
  );
}

const dialog = () => document.querySelector('dialog[open]') as HTMLDialogElement;
const click = (name: string) => act(async () => fireEvent.click(screen.getByRole('button', { name })));

// The sidebar and the post table each mount the dialogs, so their ids must not collide.
test('two callers’ dialogs each name their own heading and hint', async () => {
  render(
    <>
      <Caller name="first" docs={docsWith()} />
      <Caller name="second" docs={docsWith()} />
    </>,
  );
  await click('second rename');
  expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)).toBe(dialog().querySelector('h3'));
  const title = within(dialog()).getByRole('textbox', { name: 'Title' });
  expect(document.getElementById(title.getAttribute('aria-describedby')!)).toBe(dialog().querySelector('.name-hint'));
  await act(async () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' })));
  await click('second delete');
  expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)).toBe(dialog().querySelector('h3'));
});

const hint = () => dialog().querySelector('.name-hint')!.textContent;
const renameButton = () => within(dialog()).getByRole('button', { name: 'Rename' }) as HTMLButtonElement;

test('Rename says the post’s first # heading changes to match', async () => {
  render(<Caller name="one" docs={docsWith()} />);
  await click('one rename');
  expect(hint()).toBe('The post’s first # heading changes to match. A post without one gets one at the top.');
});

// A rename rewrites the post's text, which Claude may be changing.
test('while Claude works, Rename cannot be submitted and says it waits', async () => {
  const docs = docsWith();
  const view = render(<Caller name="one" docs={docs} busy />);
  await click('one rename');
  fireEvent.change(within(dialog()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Sun' } });

  expect(hint()).toBe('Renaming waits until Claude finishes.');
  expect(renameButton().disabled).toBe(true);

  view.rerender(<Caller name="one" docs={docs} />);
  expect(hint()).toBe('The post’s first # heading changes to match. A post without one gets one at the top.');
  expect(renameButton().disabled).toBe(false);
});

// Deleting a post deletes its outline and research documents, so the confirm names them and warns of their unsaved text.
test('Delete says the post’s research documents and outline go too, and warns when any of them has unsaved changes', async () => {
  const isPostDirty = mock((id: string) => id === moon.id);
  render(<Caller name="one" docs={docsWith({ isPostDirty })} />);
  await click('one delete');
  expect([...dialog().querySelectorAll('h3, p')].map((e) => e.textContent).filter(Boolean)).toEqual([
    'Delete “Moon”?',
    'This deletes the post’s folder on disk, with any other files in it, such as research documents, an outline, or notes. You can’t undo this.',
    'Your unsaved changes to it will be lost too.',
  ]);
  expect(isPostDirty).toHaveBeenCalledWith(moon.id);
});
