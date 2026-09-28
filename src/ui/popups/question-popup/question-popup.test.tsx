import { afterEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Passage } from '../../../shared/wire';
import { QuestionPopup } from './question-popup';

const Q1: Passage = { quote: 'as I said earlier', label: 'Q1', question: "Is this aside worth keeping? I'd cut it." };

// The pills each test put in the page.
afterEach(() => {
  document.body.innerHTML = '';
});

// The popup as the page shows it, pointing at a pill in the page.
function popup(props: Partial<Parameters<typeof QuestionPopup>[0]> = {}) {
  const pill = document.createElement('button');
  pill.textContent = 'Q1';
  document.body.append(pill);
  const onSend = mock((_message: string) => {});
  const onClose = mock(() => {});
  const onText = mock((_text: string) => {});
  const view = render(
    <QuestionPopup passage={Q1} anchor={pill} busy={false} text="" onText={onText} onSend={onSend} onClose={onClose} {...props} />,
  );
  return { pill, onSend, onClose, onText, view };
}

test('shows the question under its label, in a dialog named by the label', () => {
  popup();

  const dialog = screen.getByRole('dialog', { name: 'Q1' });

  expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText("Is this aside worth keeping? I'd cut it.").id);
});

test('points the writer to the chat when the AI gave no question text', () => {
  popup({ passage: { quote: 'as I said earlier', label: 'Q1' } });

  expect(screen.getByRole('dialog', { name: 'Q1' }).textContent).toContain('See Q1 in the chat.');
});

test('Send sends the label and the discussion, trimmed', () => {
  const { onSend, onText } = popup({ text: '  Keep it, but shorter.\n' });

  fireEvent.change(screen.getByRole('textbox', { name: 'Discuss Q1' }), { target: { value: 'more' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  expect(onText.mock.calls).toEqual([['more']]);
  expect(onSend.mock.calls).toEqual([['Q1 — Keep it, but shorter.']]);
});

test('Send and Enter send nothing while the discussion is blank', () => {
  const { onSend } = popup({ text: '  \n' });

  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Discuss Q1' }), { key: 'Enter' });

  expect(onSend.mock.calls).toEqual([]);
});

test('Enter sends the discussion, but not with Shift held or while an input method is composing', () => {
  const { onSend } = popup({ text: 'Keep it.' });
  const box = screen.getByRole('textbox', { name: 'Discuss Q1' });

  fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(box, { key: 'Enter' });

  expect(onSend.mock.calls).toEqual([['Q1 — Keep it.']]);
});

test('while the AI is replying, nothing can be sent and the popup says why', () => {
  const { onSend } = popup({ busy: true, text: 'Keep it.' });

  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Discuss Q1' }), { key: 'Enter' });

  expect(onSend.mock.calls).toEqual([]);
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Waiting for the AI to finish replying')).toBeTruthy();
});

test('the X closes the popup', () => {
  const { onClose } = popup();

  fireEvent.click(screen.getByRole('button', { name: 'Close' }));

  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Escape inside the popup closes it, and Escape elsewhere does not', () => {
  const { onClose } = popup();

  fireEvent.keyDown(document.body, { key: 'Escape' });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Discuss Q1' }), { key: 'Escape' });

  expect(onClose).toHaveBeenCalledTimes(1);
});

test('pressing outside the popup closes it, but pressing inside it or on its pill does not', () => {
  const { onClose, pill } = popup();
  const elsewhere = document.createElement('p');
  document.body.append(elsewhere);

  fireEvent.mouseDown(screen.getByRole('textbox', { name: 'Discuss Q1' }));
  fireEvent.mouseDown(pill);
  expect(onClose).toHaveBeenCalledTimes(0);

  fireEvent.mouseDown(elsewhere);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('opens with the discussion box focused', () => {
  popup();

  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Discuss Q1' }));
});

test('closing it with the X, Escape, or Send hands focus back to its pill', () => {
  const closings = [
    () => fireEvent.click(screen.getByRole('button', { name: 'Close' })),
    () => fireEvent.keyDown(screen.getByRole('textbox', { name: 'Discuss Q1' }), { key: 'Escape' }),
    () => fireEvent.click(screen.getByRole('button', { name: 'Send' })),
  ];
  for (const close of closings) {
    const { pill, view } = popup({ text: 'Keep it.' });
    close();
    expect(document.activeElement).toBe(pill);
    view.unmount();
  }
});

test('closing it once its pill is gone hands focus back to the editor the pill was in', () => {
  const editor = document.createElement('div');
  editor.className = 'ProseMirror';
  editor.tabIndex = -1;
  const pill = document.createElement('button');
  editor.append(pill);
  document.body.append(editor);
  render(<QuestionPopup passage={Q1} anchor={pill} busy={false} text="" onText={() => {}} onSend={() => {}} onClose={() => {}} />);

  pill.remove();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));

  expect(document.activeElement).toBe(editor);
});

test('closes once its pill leaves the page', async () => {
  const { onClose, pill } = popup();

  await act(async () => pill.remove());

  expect(onClose).toHaveBeenCalledTimes(1);
});

test('offers no Accept suggestions button: the writer says what they want in the discussion box', () => {
  popup();

  expect(screen.queryByRole('button', { name: 'Accept suggestions' })).toBeNull();
});
