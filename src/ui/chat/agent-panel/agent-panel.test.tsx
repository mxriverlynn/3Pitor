import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ModelChoice } from '../../../shared/wire';
import { AgentPanel } from './agent-panel';

const newChatButton = () => screen.getByRole('button', { name: 'New chat' });

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

const realFetch = globalThis.fetch;
const CATALOG = {
  providers: [{ id: 'claude-api', label: 'Claude', access: 'api', models: [{ id: 'claude-haiku-5-5', label: 'Haiku 5.5', thinking: ['low', 'medium'] }] }],
  selected: { provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium' },
};
beforeEach(() => {
  globalThis.fetch = mock(async () => Response.json(CATALOG)) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('New chat opens the picker instead of starting a chat at once', async () => {
  const onNewChat = mock(async () => {});
  render(<AgentPanel model={HAIKU} onNewChat={onNewChat} busy={false} empty />);
  expect(newChatButton().getAttribute('aria-haspopup')).toBe('dialog');
  expect(newChatButton().getAttribute('aria-expanded')).toBe('false');

  await act(async () => fireEvent.click(newChatButton()));

  expect(screen.getByRole('dialog', { name: 'New chat' })).toBeTruthy();
  expect(newChatButton().getAttribute('aria-expanded')).toBe('true');
  expect(onNewChat).not.toHaveBeenCalled();
});

test('Start in the picker starts the new chat on the chosen model, and closes the picker', async () => {
  const onNewChat = mock(async () => {});
  render(<AgentPanel model={HAIKU} onNewChat={onNewChat} busy={false} empty />);

  await act(async () => fireEvent.click(newChatButton()));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start' })));

  expect(onNewChat).toHaveBeenCalledWith({ provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium' });
  expect(screen.queryByRole('dialog', { name: 'New chat' })).toBeNull();
});

test('New chat is off while Claude works, even with messages', () => {
  render(<AgentPanel model={HAIKU} onNewChat={async () => {}} busy empty={false} />);

  expect((newChatButton() as HTMLButtonElement).disabled).toBe(true);
  expect(newChatButton().getAttribute('aria-describedby')).toBe('chat-status');
});
