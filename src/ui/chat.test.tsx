import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { SessionData } from '../shared/wire';
import { Chat, useChatSession, type ChatSession } from './chat';

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

// Answers the next chat request with a turn that stays running until the returned function finishes it with `data`.
function holdTurnOpen(data: SessionData) {
  let finish = () => {};
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/chat')) chatBodies.push(JSON.parse(String(init?.body)));
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
  return () => finish();
}

const DOCUMENTS = { 'notes.md': '# Notes typed\n', 'ideas.md': '# Ideas\n' };

type SessionOptions = Parameters<typeof useChatSession>[0];

// The chat as the page wires it: one session hook, and a fresh panel for each session.
// `onSession` hands the test the session, the way the page hands it to the question popup.
function ChatFor({ onSession, ...props }: Partial<SessionOptions> & { onSession?: (chat: ChatSession) => void }) {
  const options = { sessionId: 's1', openFile: 'notes.md', beginTurn: () => ({ documents: DOCUMENTS }), onTurnFinished: () => {}, ...props };
  const chat = useChatSession(options);
  onSession?.(chat);
  return <Chat key={options.sessionId} chat={chat} />;
}

function renderChat(props: Parameters<typeof ChatFor>[0] = {}) {
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

test('a message sent from outside the chat box shows in the chat, sent the way the chat box sends it', async () => {
  let chat!: ChatSession;
  renderChat({ onSession: (session) => (chat = session) });

  let sent = false;
  await act(async () => {
    sent = chat.send('Q1 — I accept the suggestions.');
  });

  expect(sent).toBe(true);
  expect(chatBodies).toEqual([{ text: 'Q1 — I accept the suggestions.', openFile: 'notes.md', documents: DOCUMENTS }]);
  expect(screen.getByText('Q1 — I accept the suggestions.')).toBeTruthy();
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
  const finish = holdTurnOpen(data);
  const view = renderChat({ onTurnFinished });
  await typeAndSend('Keep it');

  view.rerender(<ChatFor sessionId="s2" onTurnFinished={onTurnFinished} />);
  await act(async () => finish());
  await act(async () => {});

  expect(onTurnFinished.mock.calls).toEqual([]);
});

test('a new chat starts with an empty chat box', () => {
  const view = renderChat();
  fireEvent.change(box(), { target: { value: 'half a thought' } });

  view.rerender(<ChatFor sessionId="s2" />);

  expect(box().value).toBe('');
});

test('a message sent from outside the chat box while a turn is running is not sent', async () => {
  let chat!: ChatSession;
  holdTurnOpen({ aborted: false, edited: {} });
  renderChat({ onSession: (session) => (chat = session) });
  await typeAndSend('Keep it');

  let sent = true;
  await act(async () => {
    sent = chat.send('Q1 — I accept the suggestions.');
  });

  expect(sent).toBe(false);
  expect(chatBodies).toHaveLength(1);
  expect(screen.queryByText('Q1 — I accept the suggestions.')).toBeNull();
});

test('text put in the chat box from outside shows there, ready to edit or send', () => {
  let chat!: ChatSession;
  renderChat({ onSession: (session) => (chat = session) });

  act(() => chat.setDraft('Q2 — keep the aside'));

  expect(box().value).toBe('Q2 — keep the aside');
});
