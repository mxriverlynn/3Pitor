import { expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgentPanel } from './agent-panel';

test('clears the chat when Clear Chat is clicked', () => {
  const onClearChat = mock(() => {});
  render(<AgentPanel onClearChat={onClearChat} />);

  fireEvent.click(screen.getByRole('button', { name: 'Clear Chat' }));
  expect(onClearChat).toHaveBeenCalledTimes(1);
});
