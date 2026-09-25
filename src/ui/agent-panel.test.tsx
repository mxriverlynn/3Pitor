import { afterEach, expect, mock, test } from 'bun:test';
import { act, render, screen } from '@testing-library/react';
import { AgentPanel } from './agent-panel';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Answers the panel's workspace-config request with the given skills and agents.
function stubWorkspaceConfig(config: { skills: string[]; agents: string[] }) {
  globalThis.fetch = mock(async () => Response.json(config)) as unknown as typeof fetch;
}

// Renders inside act() so the panel's workspace-config request settles before the test looks.
async function renderPanel() {
  await act(async () => {
    render(<AgentPanel />);
  });
}

test('shows the workspace skills and agents as soon as it loads', async () => {
  stubWorkspaceConfig({ skills: ['doc-stats'], agents: ['proofreader', 'title-writer'] });
  await renderPanel();

  expect(screen.getByText('/doc-stats')).toBeTruthy();
  expect(screen.getByText('@proofreader')).toBeTruthy();
  expect(screen.getByText('@title-writer')).toBeTruthy();
});
