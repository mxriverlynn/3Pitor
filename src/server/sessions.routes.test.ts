import { expect, test } from 'bun:test';
import type { Sessions } from './sessions';
import { sessionRoutes } from './sessions.routes';

// Posts a chat body and returns the response, plus the arguments the route handed to Sessions.chat.
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
  expect((await chatWith({ text: 'Fix the spelling', openFile: 'notes.md' })).calls).toEqual([['s1', { text: 'Fix the spelling', openFile: 'notes.md', documents: undefined }]]);
});

test('runs the turn with no open file when openFile is empty, not a string, or missing', async () => {
  for (const body of [{ text: 'Hi', openFile: '' }, { text: 'Hi', openFile: 42 }, { text: 'Hi' }]) {
    expect((await chatWith(body)).calls).toEqual([['s1', { text: 'Hi', openFile: undefined, documents: undefined }]]);
  }
});

test("passes the browser's documents on to the chat turn", async () => {
  const documents = { 'notes.md': '# Notes\n', 'ideas.md': '# Ideas\n' };
  expect((await chatWith({ text: 'Hi', documents })).calls).toEqual([['s1', { text: 'Hi', openFile: undefined, documents }]]);
});

test('refuses documents that are not a map of names to markdown, and runs no turn', async () => {
  for (const documents of [['notes.md'], { 'notes.md': 42 }, 'notes.md', null]) {
    const res = await chatWith({ text: 'Hi', documents });
    expect(res.calls).toEqual([]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'documents must map file names to markdown' });
  }
});
