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
async function renderPanel(init: Parameters<typeof AgentPanel>[0]['init']) {
  await act(async () => {
    render(<AgentPanel init={init} />);
  });
}

test('asks the user to send a message before the session reports anything', async () => {
  stubWorkspaceConfig({ skills: [], agents: [] });
  await renderPanel(undefined);
  expect(screen.getByText('Skills and agents appear after the first message.')).toBeTruthy();
});

test('highlights the skills and agents the workspace defines', async () => {
  stubWorkspaceConfig({ skills: ['doc-stats'], agents: ['proofreader'] });
  await renderPanel({ skills: ['doc-stats', 'review'], agents: ['proofreader', 'general-purpose'] });

  expect(screen.getByText('/doc-stats').className).toContain('local');
  expect(screen.getByText('@proofreader').className).toContain('local');
  expect(screen.getByText('/review').className).not.toContain('local');
  expect(screen.getByText('@general-purpose').className).not.toContain('local');
});
