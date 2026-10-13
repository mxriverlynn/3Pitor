import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ModelCatalog, ModelSelection } from '../../../shared/wire';
import { ModelPicker } from './model-picker';

const realFetch = globalThis.fetch;
const ALL = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const THREE = ['low', 'medium', 'high'] as const;

const CATALOG: ModelCatalog = {
  providers: [
    { id: 'claude-cli', label: 'Claude', access: 'local', models: [{ id: 'claude-haiku-5-5', label: 'Haiku 5.5', thinking: [...ALL] }, { id: 'claude-opus-5-5', label: 'Opus 5.5', thinking: [...ALL] }] },
    { id: 'claude-api', label: 'Claude', access: 'api', models: [{ id: 'claude-haiku-5-5', label: 'Haiku 5.5', thinking: [...ALL] }, { id: 'claude-opus-5-5', label: 'Opus 5.5', thinking: [...ALL] }] },
    { id: 'openai', label: 'OpenAI', access: 'api', problem: "OPENAI_API_KEY is not set, so chat won't work with OpenAI.", models: [{ id: 'gpt-6-luna', label: 'GPT-6 Luna', thinking: [...THREE] }] },
    { id: 'google', label: 'Google Gemini', access: 'api', models: [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', thinking: [...THREE] }] },
    { id: 'ollama', label: 'Ollama', access: 'local', models: [{ id: 'llama3.2:latest', label: 'llama3.2:latest', thinking: [] }] },
  ],
  selected: { provider: 'claude-api', model: 'claude-opus-5-5', thinking: 'high' },
};

let catalog: ModelCatalog;
let fetches: number;
let opener: HTMLButtonElement;

beforeEach(() => {
  catalog = CATALOG;
  fetches = 0;
  globalThis.fetch = mock(async (url: string) => {
    if (String(url) !== '/api/models') return new Response('', { status: 404 });
    fetches++;
    return Response.json(catalog);
  }) as unknown as typeof fetch;
  opener = document.body.appendChild(document.createElement('button'));
  opener.textContent = 'New chat';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  opener.remove();
});

// Renders the picker and waits for its catalog.
async function openPicker(props: { busy?: boolean; confirmFirst?: boolean; onStart?: (s: ModelSelection) => Promise<void>; onClose?: () => void } = {}) {
  const onStart = props.onStart ?? mock(async () => {});
  const onClose = props.onClose ?? mock(() => {});
  await act(async () => {
    render(<ModelPicker opener={opener} busy={props.busy ?? false} confirmFirst={props.confirmFirst ?? false} onStart={onStart} onClose={onClose} />);
  });
  return { onStart, onClose };
}

const select = (name: string) => screen.queryByRole('combobox', { name }) as HTMLSelectElement | null;

test('the picker opens as a dialog named New chat, on the saved selection, with focus on the provider', async () => {
  await openPicker();

  expect(screen.getByRole('dialog', { name: 'New chat' })).toBeTruthy();
  expect([select('Provider')!.value, select('Model')!.value, select('Thinking')!.value]).toEqual(['claude-api', 'claude-opus-5-5', 'high']);
  expect(document.activeElement).toBe(select('Provider'));
});
