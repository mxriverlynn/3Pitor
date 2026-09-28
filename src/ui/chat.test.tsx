import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { SessionData } from '../shared/wire';
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

// A turn that ran to the end, reporting `data` in its session part.
const finishedTurn = (data: SessionData) => [
  { type: 'start' },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'Done.' },
  { type: 'text-end', id: 't1' },
  { type: 'data-session', data },
  { type: 'finish' },
];
afterEach(() => {
  globalThis.fetch = realFetch;
});

const DOCUMENTS = { 'notes.md': '# Notes typed\n', 'ideas.md': '# Ideas\n' };

type ChatProps = Parameters<typeof Chat>[0];

// The chat as the page renders it: a fresh panel for each session.
function ChatFor(props: Partial<ChatProps>) {
  const all = { sessionId: 's1', openFile: 'notes.md', beginTurn: () => ({ documents: DOCUMENTS }), onTurnFinished: () => {}, ...props };
  return <Chat key={all.sessionId} {...all} />;
}

function renderChat(props: Partial<ChatProps> = {}) {
  return render(<ChatFor {...props} />);
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

test('tells a new chat how to review a draft section by section', () => {
  renderChat();

  expect(screen.getByText(/Type \/collaborative-draft-editing to review a draft section by section\./)).toBeTruthy();
});

test('hands the edits and highlights of a finished turn to the editor', async () => {
  const onTurnFinished = mock((_data: SessionData) => {});
  const data = {
    aborted: false,
    edited: { 'notes.md': '# Notes kept\n' },
    highlights: { file: 'notes.md', passages: [{ quote: 'Notes kept', label: 'Q1' }] },
  };
  reply = finishedTurn(data);
  renderChat({ onTurnFinished });

  await typeAndSend('Keep it');
  await act(async () => {});

  expect(onTurnFinished.mock.calls).toEqual([[data]]);
});

test('a stopped turn, a failed turn, and a lost connection hand nothing to the editor', async () => {
  const onTurnFinished = mock((_data: SessionData) => {});
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

test('a turn still running when a new chat starts hands nothing to the editor, even once it finishes', async () => {
  const onTurnFinished = mock((_data: SessionData) => {});
  const data = { aborted: false, edited: { 'notes.md': '# Notes kept\n' } };
  // The first turn's stream stays open until the test finishes it.
  let finish = () => {};
  globalThis.fetch = mock(async () => {
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(stream(finishedTurn(data)).split('data: {"type":"data-session"')[0]));
        finish = () => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'data-session', data })}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n`));
          controller.close();
        };
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  const view = renderChat({ onTurnFinished });
  await typeAndSend('Keep it');

  view.rerender(<ChatFor sessionId="s2" onTurnFinished={onTurnFinished} />);
  await act(async () => finish());
  await act(async () => {});

  expect(onTurnFinished.mock.calls).toEqual([]);
});
