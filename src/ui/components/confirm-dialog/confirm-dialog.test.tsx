import { expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';

function renderDialog() {
  const onConfirm = mock(() => {});
  const onCancel = mock(() => {});
  render(<ConfirmDialog title="Start a new chat?" body="This ends the conversation." confirm="New chat" onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel, dialog: screen.getByRole('dialog', { name: 'Start a new chat?' }) };
}

test('opens as a modal dialog named by its title and described by its body, with focus on Cancel', () => {
  const { dialog } = renderDialog();

  expect((dialog as HTMLDialogElement).open).toBe(true);
  expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('This ends the conversation.');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
});

test('Cancel calls onCancel once, and nothing else', async () => {
  const { onConfirm, onCancel } = renderDialog();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('Escape calls onCancel once', async () => {
  const { onConfirm, onCancel, dialog } = renderDialog();

  await act(async () => fireEvent(dialog, new Event('cancel', { cancelable: true })));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('the confirm button calls onConfirm once, and nothing else', async () => {
  const { onConfirm, onCancel } = renderDialog();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New chat' })));

  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});
