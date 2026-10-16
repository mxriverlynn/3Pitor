import { expect, test } from 'bun:test';
import { SelectionError, type Engine } from '../../../engine/engine';
import { sessionRoutes } from './sessions.routes';

type Sessions = Engine['sessions'];

// Posts a chat body and returns the response, plus the arguments the route handed to the engine's chat.
async function chatWith(body: unknown) {
  const calls: unknown[][] = [];
  const sessions = {
    chat: (...args: unknown[]) => {
      calls.push(args);
      return new ReadableStream({ start: (controller) => controller.close() });
    },
  } as unknown as Sessions;
  const res = await sessionRoutes(sessions).request('/api/sessions/s1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { calls, status: res.status, json: () => res.json() };
}

test('passes the open file on to the chat turn', async () => {
  expect((await chatWith({ text: 'Fix the spelling', openFile: 'notes' })).calls).toEqual([['s1', { text: 'Fix the spelling', openFile: 'notes', documents: undefined }]]);
});

test('runs the turn with no open file when openFile is empty, not a string, or missing', async () => {
  for (const body of [{ text: 'Hi', openFile: '' }, { text: 'Hi', openFile: 42 }, { text: 'Hi' }]) {
    expect((await chatWith(body)).calls).toEqual([['s1', { text: 'Hi', openFile: undefined, documents: undefined }]]);
  }
});

test("passes the browser's documents on to the chat turn", async () => {
  const documents = { notes: '# Notes\n', 'ideas.md': '# Ideas\n' };
  expect((await chatWith({ text: 'Hi', documents })).calls).toEqual([['s1', { text: 'Hi', openFile: undefined, documents }]]);
});

test('refuses documents that are not a map of names to markdown, and runs no turn', async () => {
  for (const documents of [['notes'], { notes: 42 }, 'notes', null]) {
    const res = await chatWith({ text: 'Hi', documents });
    expect(res.calls).toEqual([]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'documents must map file names to markdown' });
  }
});

test('answers the current session as the engine reports it', async () => {
  const current = { id: 's1', messages: [{ id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hi' }] }], running: true, claude: 'cli' as const };
  const sessions = { current: () => current } as unknown as Sessions;
  const res = await sessionRoutes(sessions).request('/api/sessions/current');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(current);
});

const HAIKU = { provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium', providerLabel: 'Claude', modelLabel: 'Haiku 5.5', access: 'api' } as const;

// A stand-in engine whose create records the selection it was given.
function creating() {
  const given: unknown[] = [];
  const sessions = { create: async (selection?: unknown) => (given.push(selection), { id: 's2', model: HAIKU }) } as unknown as Sessions;
  return { sessions, given };
}

test('with no body, answers 201 with the new session id and its model, on the saved selection', async () => {
  const { sessions, given } = creating();
  const res = await sessionRoutes(sessions).request('/api/sessions', { method: 'POST' });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ id: 's2', model: HAIKU });
  expect(given).toEqual([undefined]);
});

test('starts the new session on the selection the body names', async () => {
  const { sessions, given } = creating();
  const selection = { provider: 'claude-cli', model: 'claude-opus-5-5', thinking: 'high' };
  const res = await sessionRoutes(sessions).request('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selection }),
  });
  expect(res.status).toBe(201);
  expect(given).toEqual([selection]);
});

test('answers 400 with the reason when the selection does not fit', async () => {
  const sessions = { create: async () => { throw new SelectionError(); } } as unknown as Sessions;
  const res = await sessionRoutes(sessions).request('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ selection: { provider: 'mistral', model: 'x' } }),
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'selection must name a known provider, a model, and a thinking level that model offers' });
});

test('answers 409 with the reason when the engine refuses the turn', async () => {
  const sessions = {
    chat: () => {
      throw new Error('session s1 already has a turn in progress');
    },
  } as unknown as Sessions;
  const res = await sessionRoutes(sessions).request('/api/sessions/s1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Hi' }),
  });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'session s1 already has a turn in progress' });
});

test('answers 500 with the error when a new session cannot be stored', async () => {
  const sessions = { create: async () => { throw new Error('disk full'); } } as unknown as Sessions;
  const res = await sessionRoutes(sessions).request('/api/sessions', { method: 'POST' });
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'disk full' });
});
