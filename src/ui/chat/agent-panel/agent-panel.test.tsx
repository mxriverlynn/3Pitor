import { expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ModelChoice } from '../../../shared/wire';
import { AgentPanel } from './agent-panel';

const newChatButton = () => screen.getByRole('button', { name: 'New chat' });
const dialog = () => screen.queryByRole('dialog', { name: 'Start a new chat?' });

const HAIKU: ModelChoice = { provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium', providerLabel: 'Claude', modelLabel: 'Haiku 5.5', access: 'api' };
const LLAMA: ModelChoice = { provider: 'ollama', model: 'llama3.2:latest', providerLabel: 'Ollama', modelLabel: 'llama3.2:latest', access: 'local' };

test('the header names the provider, says whether it runs locally or through an API, and names the model and its thinking', () => {
  render(<AgentPanel model={HAIKU} onNewChat={async () => {}} busy={false} empty />);

  expect(screen.getByRole('heading').textContent).toBe('Claude');
  expect(screen.getByText('API')).toBeTruthy();
  expect(screen.getByText('Haiku 5.5 · medium thinking')).toBeTruthy();
});

test('the header leaves out the thinking for a model that has none, and says Local for a local provider', () => {
  render(<AgentPanel model={LLAMA} onNewChat={async () => {}} busy={false} empty />);

  expect(screen.getByRole('heading').textContent).toBe('Ollama');
  expect(screen.getByText('Local')).toBeTruthy();
  expect(screen.getByText('llama3.2:latest')).toBeTruthy();
});

test('before the chat loads, the header reads Chat', () => {
  render(<AgentPanel onNewChat={async () => {}} busy={false} empty />);

  expect(screen.getByRole('heading').textContent).toBe('Chat');
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
