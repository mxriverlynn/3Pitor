import { afterEach, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { SelectionPopup, selectionMessage } from './selection-popup';

// The editors and buttons each test put in the page.
afterEach(() => {
  document.body.innerHTML = '';
});

const box = () => screen.getByRole('textbox', { name: 'Ask about the selection' });

// The popup as the page shows it, pointing at an ask button beside an editor.
function popup(props: Partial<Parameters<typeof SelectionPopup>[0]> = {}) {
  const scroller = document.createElement('div');
  const editor = document.createElement('div');
  editor.className = 'ProseMirror';
  editor.tabIndex = -1;
  const button = document.createElement('button');
  scroller.append(editor, button);
  document.body.append(scroller);
  const onSend = mock((_message: string) => {});
  const onClose = mock(() => {});
  const view = render(<SelectionPopup markdown="quick brown" anchor={button} busy={false} onSend={onSend} onClose={onClose} {...props} />);
  return { button, editor, onSend, onClose, view };
}

test('the message quotes every line of the selection, then says what the writer asked', () => {
  expect(selectionMessage('# Plan\n\nThe fox.', '  Too plain?\n')).toBe('About this passage:\n\n> # Plan\n>\n> The fox.\n\nToo plain?');
});

test('shows the selection, in a dialog, with the question box focused', () => {
  popup();

  expect(screen.getByRole('dialog', { name: 'Ask about the selection' }).textContent).toContain('quick brown');
  expect(document.activeElement).toBe(box());
});

test('Send and Enter send the selection and the question, but not while the question is blank', () => {
  const { onSend } = popup();

  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.change(box(), { target: { value: 'Too plain?' } });
  fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(box(), { key: 'Enter' });

  expect(onSend.mock.calls).toEqual([['About this passage:\n\n> quick brown\n\nToo plain?']]);
});

test('while the AI is replying, nothing can be sent and the popup says why', () => {
  const { onSend } = popup({ busy: true });

  fireEvent.change(box(), { target: { value: 'Too plain?' } });
  fireEvent.keyDown(box(), { key: 'Enter' });

  expect(onSend.mock.calls).toEqual([]);
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Waiting for the AI to finish replying')).toBeTruthy();
});

test('the X and Escape close it and hand focus back to the editor, so the selection shows again', () => {
  for (const close of [() => fireEvent.click(screen.getByRole('button', { name: 'Close' })), () => fireEvent.keyDown(box(), { key: 'Escape' })]) {
    const { editor, onClose, view } = popup();
    close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(editor);
    view.unmount();
    document.body.innerHTML = '';
  }
});

test('pressing outside the popup closes it, but pressing inside it or on its button does not', () => {
  const { onClose, button } = popup();
  const elsewhere = document.createElement('p');
  document.body.append(elsewhere);

  fireEvent.mouseDown(box());
  fireEvent.mouseDown(button);
  expect(onClose).toHaveBeenCalledTimes(0);

  fireEvent.mouseDown(elsewhere);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('choosing an agent action puts its command in the question box', () => {
  popup();

  fireEvent.click(screen.getByRole('button', { name: 'Agent Actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Proofread' }));

  expect((box() as HTMLTextAreaElement).value).toBe('/proofread ');
});

test('Escape in the agent actions menu closes the menu and leaves the popup open', () => {
  const { onClose } = popup();
  fireEvent.click(screen.getByRole('button', { name: 'Agent Actions' }));

  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

  expect(screen.queryByRole('menu')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});
