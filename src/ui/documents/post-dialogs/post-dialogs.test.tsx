import { expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { PostSummary } from '../../../shared/wire';
import { usePostDialogs, type PostDialogsDocs } from './post-dialogs';

const moon: PostSummary = { id: '1/p 1', title: 'Moon' };

function docsWith(more: Partial<PostDialogsDocs> = {}): PostDialogsDocs {
  return {
    posts: [moon],
    isDirty: () => false,
    createPost: mock(async () => 'new id'),
    rename: mock(async () => {}),
    remove: mock(async () => {}),
    ...more,
  };
}

// One caller of the dialogs: a button for each, named after `name`.
function Caller({ name, docs, onClose }: { name: string; docs: PostDialogsDocs; onClose?: () => void }) {
  const { askNewPost, askRename, askDelete, dialogs } = usePostDialogs(docs, () => {}, onClose);
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
