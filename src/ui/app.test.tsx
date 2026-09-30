import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { CurrentSession, HostEvent, SessionData, ViewState } from '../shared/wire';
import { App } from './app';
import { type FakeDocumentsApi, fakeDocumentsApi } from './components/fake-documents-api';

const realFetch = globalThis.fetch;
const realWebSocket = globalThis.WebSocket;
// The workspace, as the documents routes serve it.
let documents: FakeDocumentsApi;
// What each chat request answers with, in turn: a whole turn's stream parts, or a stream from heldTurn.
let replies: (object[] | ReadableStream)[];

// A turn that keeps running until `finish` ends it with `parts`.
function heldTurn() {
  let controller!: ReadableStreamDefaultController;
  const reply = new ReadableStream({
    start: (c) => {
      controller = c;
      c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'start' })}\n\n`));
    },
  });
  const finish = (parts: object[]) => {
    controller.enqueue(new TextEncoder().encode(stream(parts.slice(1))));
    controller.close();
  };
  return { reply, finish };
}
let chatBodies: { text: string; openFile?: string }[];
// The server's current session, as GET /api/sessions/current answers it.
let current: CurrentSession;
// Every request other than the documents routes, as "METHOD path".
let requests: string[];
// The host events sockets the page opened, newest last.
let sockets: FakeSocket[];
// The stored editor view, as GET /api/view-state answers it; each PUT replaces it.
let storedView: ViewState;

// A host events socket the test opens and sends events down.
class FakeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  constructor() {
    sockets.push(this);
  }
  close() {}
  open() {
    this.onopen?.();
  }
  send(event: HostEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

const stream = (parts: object[]) => [...parts.map((part) => `data: ${JSON.stringify(part)}\n\n`), 'data: [DONE]\n\n'].join('');

// A turn that ran to the end, reporting `data` in its session part.
const finishedTurn = (data: SessionData) => [
  { type: 'start' },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'Done.' },
  { type: 'text-end', id: 't1' },
  { type: 'data-session', data },
  { type: 'finish' },
];

const Q1 = { quote: 'quick brown', label: 'Q1', question: 'Is the fox too plain?' };
const highlightQ1 = finishedTurn({ aborted: false, edited: {}, highlights: { file: 'notes.md', passages: [Q1] } });

beforeEach(() => {
  documents = fakeDocumentsApi({ 'notes.md': '# Notes\n\nThe quick brown fox.\n', 'ideas.md': '# Ideas\n' });
  replies = [];
  chatBodies = [];
  current = { id: 's1', messages: [], running: false, claude: 'api' };
  requests = [];
  sockets = [];
  storedView = { mode: 'rendered', unsaved: [], notApplied: [] };
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (!path.startsWith('/api/documents')) requests.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/api/sessions/current') return Response.json(current);
    if (path === '/api/view-state') {
      if (init?.method === 'PUT') storedView = JSON.parse(String(init.body));
      return Response.json(init?.method === 'PUT' ? { ok: true } : storedView);
    }
    if (path === '/api/sessions') {
      current = { id: 's2', messages: [], running: false, claude: current.claude };
      return Response.json({ id: current.id });
    }
    if (path.endsWith('/cancel')) return Response.json({ cancelled: true });
    if (path.endsWith('/chat')) {
      chatBodies.push(JSON.parse(String(init?.body)));
      const reply = replies.shift() ?? finishedTurn({ aborted: false, edited: {} });
      return new Response(reply instanceof ReadableStream ? reply : stream(reply), { headers: { 'content-type': 'text/event-stream' } });
    }
    return (await documents.handle(path, init))!;
  }) as unknown as typeof fetch;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realWebSocket;
});

const chatBox = () => screen.getByPlaceholderText('Ask the agent to edit your document…') as HTMLTextAreaElement;
const chatSend = () => within(chatBox().parentElement!).getByRole('button', { name: 'Send' });

// Renders the page and sends one chat message, whose turn answers with `reply`.
async function afterTurn(reply: object[]) {
  const view = render(<App />);
  await act(async () => {});
  replies.push(reply);
  fireEvent.change(chatBox(), { target: { value: '/collaborative-editing notes.md' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });
  await act(async () => {});
  return view;
}

const pill = (view: ReturnType<typeof render>) => view.container.querySelector('.ai-highlight-label') as HTMLElement;

test('the Agent heading says whether chat reaches Claude through the claude program or the API', async () => {
  current = { ...current, claude: 'cli' };
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Agent (CLI)' })).toBeTruthy();
});

test('clicking a question pill opens its question', async () => {
  const view = await afterTurn(highlightQ1);

  await act(async () => fireEvent.click(pill(view)));

  expect(screen.getByRole('dialog', { name: 'Q1' }).textContent).toContain('Is the fox too plain?');
});

test('a message sent from the popup shows in the chat as the writer’s, and the popup closes', async () => {
  const view = await afterTurn(highlightQ1);
  await act(async () => fireEvent.click(pill(view)));
  replies.push(heldTurn().reply);

  fireEvent.change(screen.getByRole('textbox', { name: 'Discuss Q1' }), { target: { value: 'Keep it, but shorter.' } });
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send' }));
  });
  await act(async () => {});

  expect(chatBodies.at(-1)?.text).toBe('Q1 — Keep it, but shorter.');
  expect([...view.container.querySelectorAll('.msg.user')].at(-1)?.textContent).toBe('Q1 — Keep it, but shorter.');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a turn ending closes the popup, and moves what the writer typed in it into the chat box', async () => {
  const view = await afterTurn(highlightQ1);
  await act(async () => fireEvent.click(pill(view)));
  const turn = heldTurn();
  replies.push(turn.reply);
  fireEvent.change(chatBox(), { target: { value: 'Is the ending too long?' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });

  fireEvent.change(screen.getByRole('textbox', { name: 'Discuss Q1' }), { target: { value: ' Keep it, but shorter. ' } });
  fireEvent.change(chatBox(), { target: { value: 'Also the title.' } });
  await act(async () => turn.finish(highlightQ1));
  await act(async () => {});

  expect(screen.queryByRole('dialog')).toBeNull();
  expect(chatBox().value).toBe('Also the title.\n\nQ1 — Keep it, but shorter.');
});

test('a turn that answers one question without highlighting keeps the other question highlighted', async () => {
  const Q2 = { quote: 'Notes', label: 'Q2', question: 'Is the title too plain?' };
  const view = await afterTurn(finishedTurn({ aborted: false, edited: {}, highlights: { file: 'notes.md', passages: [Q1, Q2] } }));
  replies.push(finishedTurn({ aborted: false, edited: { 'notes.md': '# Notes\n\nThe slow red fox.\n' } }));

  fireEvent.change(chatBox(), { target: { value: 'Q1 — make it slow and red' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });
  await act(async () => {});

  expect([...view.container.querySelectorAll('.ai-highlight-label')].map((el) => el.textContent)).toEqual(['Q2']);
});

test('switching to another file and back does not bring the popup back', async () => {
  const view = await afterTurn(highlightQ1);
  await act(async () => fireEvent.click(pill(view)));

  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^ideas\.md/ })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^notes\.md/ })));

  expect(pill(view)).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('asking about a selection sends it through the chat, and the popup closes', async () => {
  const view = render(<App />);
  await act(async () => {});
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^notes\.md/ })));
  const editor = view.container.querySelector('.ProseMirror') as HTMLElement;
  await act(async () => editor.focus());
  const text = [...editor.querySelectorAll('p')].find((p) => p.textContent === 'The quick brown fox.')!.firstChild!;
  await act(async () => {
    document.getSelection()!.setBaseAndExtent(text, 4, text, 15);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ask the AI about the selection' })));
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask about the selection' }), { target: { value: 'Too plain?' } });
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send' }));
  });
  await act(async () => {});

  expect(chatBodies.at(-1)?.text).toBe('About this passage:\n\n> quick brown\n\nToo plain?');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a message sent with no file open names no open file', async () => {
  render(<App />);
  await act(async () => {});

  fireEvent.change(chatBox(), { target: { value: 'What should I write next?' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });
  await act(async () => {});

  expect(chatBodies).toHaveLength(1);
  expect('openFile' in chatBodies[0]!).toBe(false);
});

test('while the AI works the tree cannot be changed, and files still open', async () => {
  documents.folders.add('drafts');
  render(<App />);
  await act(async () => {});
  const turn = heldTurn();
  replies.push(turn.reply);
  fireEvent.change(chatBox(), { target: { value: 'Tidy up my notes' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });

  const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;
  expect([disabled('New file or folder'), disabled('Actions for drafts')]).toEqual([true, true]);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^notes\.md/ })));
  expect(screen.getByText('Tidy up my notes')).toBeTruthy();
  expect(document.querySelector('.editor-bar .name')?.textContent).toBe('notes.md');

  await act(async () => turn.finish(finishedTurn({ aborted: false, edited: {} })));
  await act(async () => {});
  expect([disabled('New file or folder'), disabled('Actions for drafts')]).toEqual([false, false]);
});

const storedChat = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Fix the spelling' }] },
  { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Fixed two typos.' }] },
];

test('a reload brings back the chat, and the next message goes to the same session with only the new text', async () => {
  current = { id: 's9', messages: storedChat, running: false, claude: 'api' };
  render(<App />);
  await act(async () => {});

  expect(screen.getByText('Fixed two typos.')).toBeTruthy();
  fireEvent.change(chatBox(), { target: { value: 'Now the title' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });
  await act(async () => {});

  expect(requests.filter((r) => r.includes('/api/sessions'))).toEqual(['GET /api/sessions/current', 'POST /api/sessions/s9/chat']);
  expect(chatBodies.map((body) => body.text)).toEqual(['Now the title']);
});

const request = { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Tighten the intro' }] };
const reply = { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'Tightened it.' }, { type: 'data-session', data: { aborted: false, edited: {} } }] };

test('a reload while the AI works shows it working, and its reply arrives when this session’s turn finishes', async () => {
  current = { id: 's9', messages: [...storedChat, request], running: true, claude: 'api' };
  render(<App />);
  await act(async () => {});
  await act(async () => sockets[0].open());

  expect(screen.getByText('thinking…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();

  await act(async () => sockets[0].send({ type: 'turn-finished', sessionId: 'other', aborted: false }));
  expect(screen.getByText('thinking…')).toBeTruthy();

  current = { id: 's9', messages: [...storedChat, request, reply], running: false, claude: 'api' };
  await act(async () => sockets[0].send({ type: 'turn-finished', sessionId: 's9', aborted: false }));
  await act(async () => {});

  expect(screen.getByText('Tightened it.')).toBeTruthy();
  expect(screen.queryByText('thinking…')).toBeNull();
  expect(chatSend()).toBeTruthy();
});

test('a turn that finished before the events socket connected is still picked up', async () => {
  current = { id: 's9', messages: [...storedChat, request], running: true, claude: 'api' };
  render(<App />);
  await act(async () => {});

  current = { id: 's9', messages: [...storedChat, request, reply], running: false, claude: 'api' };
  await act(async () => sockets[0].open());
  await act(async () => {});

  expect(screen.getByText('Tightened it.')).toBeTruthy();
  expect(screen.queryByText('thinking…')).toBeNull();
});

test('Stop while waiting on a turn begun before the reload cancels it on the server', async () => {
  current = { id: 's9', messages: [...storedChat, request], running: true, claude: 'api' };
  render(<App />);
  await act(async () => {});

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })));

  expect(requests).toContain('POST /api/sessions/s9/cancel');
});

test('a turn that finished while the page was loading its chat, with the socket already open, is still picked up', async () => {
  current = { id: 's9', messages: [...storedChat, request], running: true, claude: 'api' };
  const answer = globalThis.fetch;
  let loaded!: () => void;
  const loading = new Promise<void>((resolve) => (loaded = resolve));
  // The first answer about the current session is held until the socket is open and the turn has ended.
  let held = false;
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (String(url) === '/api/sessions/current' && !held) {
      held = true;
      const running = current;
      await loading;
      return Response.json(running);
    }
    return answer(url, init);
  }) as unknown as typeof fetch;
  render(<App />);
  await act(async () => sockets[0].open());

  current = { id: 's9', messages: [...storedChat, request, reply], running: false, claude: 'api' };
  await act(async () => loaded());
  await act(async () => {});

  expect(screen.getByText('Tightened it.')).toBeTruthy();
});

test('a chat that cannot be loaded says why, and Clear Chat starts a new one', async () => {
  const answer = globalThis.fetch;
  globalThis.fetch = mock(async (url: string, init?: RequestInit) =>
    String(url) === '/api/sessions/current' ? Response.json({ error: 'the server is out of memory' }, { status: 500 }) : answer(url, init),
  ) as unknown as typeof fetch;
  render(<App />);
  await act(async () => {});

  expect(screen.getByText('Could not load the chat: the server is out of memory')).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Clear Chat' })));
  expect(screen.queryByText(/Could not load the chat/)).toBeNull();
  expect(chatBox()).toBeTruthy();
});

test('a page that waited on a turn through a reload takes in its edits once it finishes, and only once', async () => {
  storedView = { ...storedView, current: 'notes.md' };
  current = { id: 's9', messages: [...storedChat, request], running: true, claude: 'api' };
  render(<App />);
  await act(async () => {});
  await act(async () => sockets[0].open());

  const edited = { ...reply, parts: [{ type: 'data-session', data: { aborted: false, edited: { 'notes.md': '# Notes\n\nThe slow red fox.\n' } } }] };
  current = { id: 's9', messages: [...storedChat, request, edited], running: false, claude: 'api' };
  await act(async () => sockets[0].send({ type: 'turn-finished', sessionId: 's9', aborted: false }));
  await act(async () => {});
  await act(async () => sockets[0].send({ type: 'turn-finished', sessionId: 's9', aborted: false }));
  await act(async () => {});

  const paragraphs = [...document.querySelectorAll('.ProseMirror p')].map((p) => p.textContent);
  expect(paragraphs).toEqual(['The slow red fox.']);
  expect(document.querySelector('.editor-bar .name')?.textContent).toBe('notes.md');
});
