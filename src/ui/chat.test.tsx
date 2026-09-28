import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Chat } from './chat';

const realFetch = globalThis.fetch;
let chatBodies: unknown[];
// The UI message stream parts the next chat request answers with.
let reply: object[];

// A UI message stream (SSE) carrying `parts`, the way the chat route sends a turn.
const stream = (parts: object[]) => [...parts.map((part) => `data: ${JSON.stringify(part)}\n\n`), 'data: [DONE]\n\n'].join('');

// Records every chat request's body and answers with `reply`.
beforeEach(() => {
  chatBodies = [];
  reply = [];
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/chat')) chatBodies.push(JSON.parse(String(init?.body)));
    return new Response(stream(reply), { headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
});

// A turn that ran to the end, reporting `edited`.
const finishedTurn = (edited: Record<string, string>) => [
  { type: 'start' },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'Done.' },
  { type: 'text-end', id: 't1' },
  { type: 'data-session', data: { aborted: false, edited } },
  { type: 'finish' },
];
afterEach(() => {
  globalThis.fetch = realFetch;
});

const DOCUMENTS = { 'notes.md': '# Notes typed\n', 'ideas.md': '# Ideas\n' };

function renderChat(props: Partial<Parameters<typeof Chat>[0]> = {}) {
  const all = { sessionId: 's1', openFile: 'notes.md', beginTurn: () => ({ documents: DOCUMENTS }), onTurnFinished: () => {}, ...props };
  return render(<Chat {...all} />);
}

const box = () => screen.getByPlaceholderText('Ask the agent to edit your document…') as HTMLTextAreaElement;

async function typeAndSend(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByText('Send'));
  });
}

test('sends the message with the open file and what the editor holds, without saving anything', async () => {
  renderChat();

  await typeAndSend('Fix the spelling');

  expect(chatBodies).toEqual([{ text: 'Fix the spelling', openFile: 'notes.md', documents: DOCUMENTS }]);
  expect(box().value).toBe('');
});

test('tells a new chat that requests apply to the open file', () => {
  renderChat();

  expect(screen.getByText(/Requests that don't name a file apply to the file open in the editor\./)).toBeTruthy();
});

test('hands the edits of a finished turn to the editor', async () => {
  const onTurnFinished = mock((_edited: Record<string, string>) => {});
  reply = finishedTurn({ 'notes.md': '# Notes kept\n' });
  renderChat({ onTurnFinished });

  await typeAndSend('Keep it');
  await act(async () => {});

  expect(onTurnFinished.mock.calls).toEqual([[{ 'notes.md': '# Notes kept\n' }]]);
});

test('a stopped turn, a failed turn, and a lost connection hand nothing to the editor', async () => {
  const onTurnFinished = mock((_edited: Record<string, string>) => {});
  const stopped = [{ type: 'start' }, { type: 'data-session', data: { aborted: true, edited: {} } }, { type: 'finish' }];
  const failed = [{ type: 'start' }, { type: 'error', errorText: 'the model is overloaded' }];

  for (const parts of [stopped, failed]) {
    reply = parts;
    const view = renderChat({ onTurnFinished });
    await typeAndSend('Keep it');
    await act(async () => {});
    view.unmount();
  }
  globalThis.fetch = mock(async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  renderChat({ onTurnFinished });
  await typeAndSend('Keep it');
  await act(async () => {});

  expect(onTurnFinished.mock.calls).toEqual([]);
});
