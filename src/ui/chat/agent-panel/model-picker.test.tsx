import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

test('when the new chat cannot start, the picker stays open on the choice and says why', async () => {
  const onStart = mock(async () => {
    throw new Error('disk full');
  });
  const { onClose } = await openPicker({ onStart });

  await act(async () => fireEvent.click(startButton()));

  expect(screen.getByRole('alert').textContent).toBe('Could not start a new chat: disk full');
  expect(onClose).not.toHaveBeenCalled();
  expect(select('Model')!.value).toBe('claude-opus-5-5');
  expect(startButton().disabled).toBe(false);
});

const confirmDialog = () => screen.queryByRole('dialog', { name: 'Start a new chat?' });

test('in a chat that holds something, Start asks first; Cancel goes back to Start with the choice kept', async () => {
  const { onStart } = await openPicker({ confirmFirst: true });
  await choose('Provider', 'claude-cli');

  await act(async () => fireEvent.click(startButton()));
  expect(confirmDialog()!.textContent).toContain("This ends the conversation for good and removes Claude's highlights and Undo all.");

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));

  expect(onStart).not.toHaveBeenCalled();
  expect(confirmDialog()).toBeNull();
  expect(document.activeElement).toBe(startButton());
  expect(select('Provider')!.value).toBe('claude-cli');
});

test('confirming the question starts the new chat on the choice', async () => {
  const { onStart, onClose } = await openPicker({ confirmFirst: true });

  await act(async () => fireEvent.click(startButton()));
  await act(async () => fireEvent.click(within(confirmDialog()!).getByRole('button', { name: 'New chat' })));

  expect(onStart).toHaveBeenCalledWith({ provider: 'claude-api', model: 'claude-opus-5-5', thinking: 'high' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Escape closes the picker and puts focus back on New chat', async () => {
  const { onClose } = await openPicker();

  await act(async () => fireEvent.keyDown(select('Provider')!, { key: 'Escape' }));

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(opener);
});

test('a press outside the picker closes it, but not while it is asking before the old chat ends', async () => {
  const outside = document.body.appendChild(document.createElement('div'));
  const { onClose } = await openPicker({ confirmFirst: true });

  await act(async () => fireEvent.click(startButton()));
  await act(async () => fireEvent.pointerDown(confirmDialog()!));
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })));
  await act(async () => fireEvent.pointerDown(outside));
  expect(onClose).toHaveBeenCalledTimes(1);
  outside.remove();
});

test('Start is off while a turn runs', async () => {
  await openPicker({ busy: true });
  expect(startButton().disabled).toBe(true);
});

test('while the new chat is on its way, Start reads Starting… and cannot be pressed again', async () => {
  let finish!: () => void;
  const onStart = mock(() => new Promise<void>((resolve) => (finish = resolve)));
  await openPicker({ onStart });

  await act(async () => fireEvent.click(startButton()));
  const starting = screen.getByRole('button', { name: 'Starting…' }) as HTMLButtonElement;
  expect(starting.disabled).toBe(true);

  await act(async () => finish());
  expect(onStart).toHaveBeenCalledTimes(1);
});

test('while the models load, the picker says so and Start is off', async () => {
  let answer!: (r: Response) => void;
  globalThis.fetch = mock(() => new Promise<Response>((resolve) => (answer = resolve))) as unknown as typeof fetch;
  await openPicker();

  expect(screen.getByText('Loading models…')).toBeTruthy();
  expect(startButton().disabled).toBe(true);

  await act(async () => answer(Response.json(catalog)));
  expect(screen.queryByText('Loading models…')).toBeNull();
});

test('when the models cannot be loaded, the picker says why and Start stays off', async () => {
  globalThis.fetch = mock(async () => Response.json({ error: 'server down' }, { status: 500 })) as unknown as typeof fetch;
  await openPicker();

  expect(screen.getByRole('alert').textContent).toBe('Could not load the models: server down');
  expect(startButton().disabled).toBe(true);
});

test('each time the picker opens it reads the saved selection afresh', async () => {
  await openPicker();
  catalog = { ...CATALOG, selected: { provider: 'ollama', model: 'llama3.2:latest' } };
  await openPicker();

  expect(fetches).toBe(2);
  expect(screen.getAllByRole('combobox', { name: 'Provider' }).map((s) => (s as HTMLSelectElement).value)).toEqual(['claude-api', 'ollama']);
});

test('Ollama with no models pulled says so, and will not start', async () => {
  catalog = { ...CATALOG, providers: CATALOG.providers.map((p) => (p.id === 'ollama' ? { ...p, models: [] } : p)) };
  await openPicker();

  await choose('Provider', 'ollama');

  expect(screen.getByText('No models pulled in Ollama')).toBeTruthy();
  expect(select('Model')).toBeNull();
  expect(startButton().disabled).toBe(true);
});

test('a saved model that is no longer listed opens on the first model, and says the saved one is not available', async () => {
  catalog = { ...CATALOG, selected: { provider: 'ollama', model: 'mistral:7b' } };
  await openPicker();

  expect([select('Provider')!.value, select('Model')!.value]).toEqual(['ollama', 'llama3.2:latest']);
  expect(screen.getByText('Your saved model mistral:7b is not available.')).toBeTruthy();
});
