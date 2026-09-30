import { afterEach, beforeEach, expect, jest, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { SessionData } from '../../../shared/wire';
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
  jest.useRealTimers();
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

const NEW_CHAT = { id: 's1', messages: [], waiting: false };
const chatWithId = (id: string) => ({ id, messages: [], waiting: false });

// The chat as the page wires it: one session hook, and a fresh panel for each session.
// `onSession` hands the test the session, the way the page hands it to the question popup.
function ChatFor({ onSession, ...props }: Partial<SessionOptions> & { onSession?: (chat: ChatSession) => void }) {
  const options = { chat: NEW_CHAT, openFile: 'notes.md', beginTurn: () => ({ documents: DOCUMENTS }), onTurnFinished: () => {}, ...props };
  const chat = useChatSession(options);
  onSession?.(chat);
  return <Chat key={options.chat?.id} chat={chat} />;
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

  expect(screen.getByText(/Type \/collaborative-editing to review a draft section by section\./)).toBeTruthy();
});

test('hands the edits and highlights of a finished turn to the editor', async () => {
  const onTurnFinished = mock((_id: string, _data: SessionData) => {});
  const data = {
    aborted: false,
    edited: { 'notes.md': '# Notes kept\n' },
    highlights: { file: 'notes.md', passages: [{ quote: 'Notes kept', label: 'Q1' }] },
  };
  reply = finishedTurn(data);
  renderChat({ onTurnFinished });

  await typeAndSend('Keep it');
  await act(async () => {});

  expect(onTurnFinished.mock.calls).toEqual([[expect.any(String), data]]);
});

test('a stopped turn, a failed turn, and a lost connection hand nothing to the editor', async () => {
  const onTurnFinished = mock((_id: string, _data: SessionData) => {});
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
  const onTurnFinished = mock((_id: string, _data: SessionData) => {});
  const data = { aborted: false, edited: { 'notes.md': '# Notes kept\n' } };
  const finish = holdTurnOpen(data);
  const view = renderChat({ onTurnFinished });
  await typeAndSend('Keep it');

  view.rerender(<ChatFor chat={chatWithId('s2')} onTurnFinished={onTurnFinished} />);
  await act(async () => finish());
  await act(async () => {});

  expect(onTurnFinished.mock.calls).toEqual([]);
});

test('a new chat starts with an empty chat box', () => {
  const view = renderChat();
  fireEvent.change(box(), { target: { value: 'half a thought' } });

  view.rerender(<ChatFor chat={chatWithId('s2')} />);

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

test('choosing Collaborative Editing from the agent actions puts its skill in the chat box', () => {
  renderChat();

  fireEvent.click(screen.getByRole('button', { name: 'Agent Actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Collaborative Editing' }));

  expect(box().value).toBe('/collaborative-editing ');
});

test('the agent actions menu closes once an action is chosen', () => {
  renderChat();

  fireEvent.click(screen.getByRole('button', { name: 'Agent Actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Collaborative Editing' }));

  expect(screen.queryByRole('menu')).toBeNull();
});

test('the agent actions button shows only a slash', () => {
  renderChat();

  expect(screen.getByRole('button', { name: 'Agent Actions' }).textContent).toBe('/');
});

test('choosing Proofread from the agent actions puts its skill in the chat box', () => {
  renderChat();

  fireEvent.click(screen.getByRole('button', { name: 'Agent Actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Proofread' }));

  expect(box().value).toBe('/proofread ');
});

test('choosing Research from the agent actions puts its skill in the chat box', () => {
  renderChat();

  fireEvent.click(screen.getByRole('button', { name: 'Agent Actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Research' }));

  expect(box().value).toBe('/research ');
});

const storedChat = {
  id: 's7',
  messages: [
    { id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Fix the spelling' }] },
    { id: 'a1', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'Fixed two typos.' }] },
  ],
  waiting: false,
};

test('a chat brought back from the server shows its messages, and the next message sends only the new text', async () => {
  const urls: string[] = [];
  const answer = globalThis.fetch;
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    return answer(url, init);
  }) as unknown as typeof fetch;
  renderChat({ chat: storedChat });

  expect(screen.getByText('Fix the spelling')).toBeTruthy();
  expect(screen.getByText('Fixed two typos.')).toBeTruthy();
  await typeAndSend('Now the title');
  expect(urls).toEqual(['/api/sessions/s7/chat']);
  expect(chatBodies).toEqual([{ text: 'Now the title', openFile: 'notes.md', documents: DOCUMENTS }]);
});

test('a chat waiting on a turn begun before the reload shows it working, sends nothing, and can stop it', async () => {
  const urls: string[] = [];
  globalThis.fetch = mock(async (url: string) => {
    urls.push(String(url));
    return Response.json({ cancelled: true });
  }) as unknown as typeof fetch;
  let chat!: ChatSession;
  renderChat({ chat: { ...storedChat, waiting: true }, onSession: (session) => (chat = session) });

  expect(screen.getByText('thinking…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  let sent = true;
  await act(async () => {
    sent = chat.send('Another thing');
  });
  expect(sent).toBe(false);

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })));
  expect(urls).toEqual(['/api/sessions/s7/cancel']);
});

test('a running turn shows a working bar above the chat box', async () => {
  holdTurnOpen({ aborted: false, edited: {} });
  renderChat();

  await typeAndSend('Keep it');

  const bar = screen.getByRole('status');
  expect(bar.textContent).toBe('Working ');
  expect(bar.nextElementSibling?.className).toBe('composer');
});

test('the working bar adds a dot every 300ms, up to three, then starts over', async () => {
  holdTurnOpen({ aborted: false, edited: {} });
  renderChat();
  jest.useFakeTimers();
  await typeAndSend('Keep it');

  const shown = [];
  for (let i = 0; i < 4; i++) {
    act(() => jest.advanceTimersByTime(300));
    shown.push(screen.getByRole('status').textContent);
  }

  expect(shown).toEqual(['Working .', 'Working ..', 'Working ...', 'Working ']);
});

test('the working bar goes away once the turn finishes', async () => {
  const finish = holdTurnOpen({ aborted: false, edited: {} });
  renderChat();
  await typeAndSend('Keep it');

  await act(async () => finish());
  await act(async () => {});

  expect(screen.queryByRole('status')).toBeNull();
});
