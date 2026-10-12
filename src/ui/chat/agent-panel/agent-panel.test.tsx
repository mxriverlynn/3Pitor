import { expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AgentPanel } from './agent-panel';

const newChatButton = () => screen.getByRole('button', { name: 'New chat' });
const dialog = () => screen.queryByRole('dialog', { name: 'Start a new chat?' });

test('the panel is headed Claude, with no chat mode', () => {
  render(<AgentPanel onNewChat={() => {}} busy={false} empty />);

  expect(screen.getByRole('heading').textContent).toBe('Claude');
});

test('New chat in an empty chat starts a new one at once, without asking', async () => {
  const onNewChat = mock(() => {});
  render(<AgentPanel onNewChat={onNewChat} busy={false} empty />);

  await act(async () => fireEvent.click(newChatButton()));

  expect(onNewChat).toHaveBeenCalledTimes(1);
  expect(dialog()).toBeNull();
});

test('New chat in a chat that is not empty asks first, and confirming starts a new one once', async () => {
  const onNewChat = mock(() => {});
  render(<AgentPanel onNewChat={onNewChat} busy={false} empty={false} />);

  await act(async () => fireEvent.click(newChatButton()));
  expect(onNewChat).not.toHaveBeenCalled();
  expect(dialog()!.textContent).toContain(
    "This ends the conversation for good and removes Claude's highlights and Undo all. Your posts stay as they are.",
  );

  await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'New chat' }).at(-1)!));

  expect(onNewChat).toHaveBeenCalledTimes(1);
  expect(dialog()).toBeNull();
});

test('cancelling New chat starts nothing and puts focus back on New chat', async () => {
  const onNewChat = mock(() => {});
  render(<AgentPanel onNewChat={onNewChat} busy={false} empty={false} />);

  await act(async () => fireEvent.click(newChatButton()));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));

  expect(onNewChat).not.toHaveBeenCalled();
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(newChatButton());
});

test('New chat is off while Claude works, even with messages', () => {
  render(<AgentPanel onNewChat={() => {}} busy empty={false} />);

  expect((newChatButton() as HTMLButtonElement).disabled).toBe(true);
  expect(newChatButton().getAttribute('aria-describedby')).toBe('chat-status');
});
