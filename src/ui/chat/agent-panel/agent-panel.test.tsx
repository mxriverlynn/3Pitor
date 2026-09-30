import { expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgentPanel } from './agent-panel';

test('clears the chat when Clear Chat is clicked', () => {
  const onClearChat = mock(() => {});
  render(<AgentPanel onClearChat={onClearChat} />);

  fireEvent.click(screen.getByRole('button', { name: 'Clear Chat' }));
  expect(onClearChat).toHaveBeenCalledTimes(1);
});

test('names the chat mode next to Agent, once it is known', () => {
  const { rerender } = render(<AgentPanel onClearChat={() => {}} />);
  expect(screen.getByRole('heading').textContent).toBe('Agent');
  rerender(<AgentPanel claude="cli" onClearChat={() => {}} />);
  expect(screen.getByRole('heading').textContent).toBe('Agent (CLI)');
  rerender(<AgentPanel claude="api" onClearChat={() => {}} />);
  expect(screen.getByRole('heading').textContent).toBe('Agent (API)');
});
