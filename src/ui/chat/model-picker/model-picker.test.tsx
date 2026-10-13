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

// Picks `value` in the list named `name`.
const choose = (name: string, value: string) => act(async () => void fireEvent.change(select(name)!, { target: { value } }));

test('changing the provider picks its first model, and keeps the thinking level when that model offers it, else medium', async () => {
  await openPicker();

  await choose('Provider', 'claude-cli');
  expect([select('Model')!.value, select('Thinking')!.value]).toEqual(['claude-haiku-5-5', 'high']);

  await choose('Thinking', 'max');
  await choose('Provider', 'google');
  expect([select('Model')!.value, select('Thinking')!.value]).toEqual(['gemini-3.8-flash', 'medium']);
});

test('a model with no thinking levels has no Thinking list', async () => {
  await openPicker();

  await choose('Provider', 'ollama');

  expect(select('Model')!.value).toBe('llama3.2:latest');
  expect(select('Thinking')).toBeNull();
});

const startButton = () => screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement;

test('a provider that cannot work says so in the list, and choosing it shows why and will not start', async () => {
  await openPicker();
  const option = [...select('Provider')!.options].find((o) => o.value === 'openai')!;
  expect(option.textContent).toBe('OpenAI (API), unavailable');
  expect(startButton().disabled).toBe(false);

  await choose('Provider', 'openai');

  const reason = screen.getByText("OPENAI_API_KEY is not set, so chat won't work with OpenAI.");
  expect(select('Provider')!.getAttribute('aria-describedby')).toBe(reason.id);
  expect([select('Model'), select('Thinking')]).toEqual([null, null]);
  expect(startButton().disabled).toBe(true);
});

test('in an empty chat, Start begins the new chat on the choice, then closes the picker', async () => {
  const { onStart, onClose } = await openPicker();
  await choose('Provider', 'google');

  await act(async () => fireEvent.click(startButton()));

  expect(onStart).toHaveBeenCalledWith({ provider: 'google', model: 'gemini-3.8-flash', thinking: 'high' });
  expect(onClose).toHaveBeenCalledTimes(1);
});
