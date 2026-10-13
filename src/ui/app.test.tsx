import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CurrentSession, HostEvent, ModelChoice, ModelSelection, ProviderEntry, SessionData, ViewState } from '../shared/wire';
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

// The providers the New chat picker offers.
const PROVIDERS: ProviderEntry[] = [
  { id: 'claude-api', label: 'Claude', access: 'api', models: [{ id: 'claude-haiku-5-5', label: 'Haiku 5.5', thinking: ['low', 'medium', 'high'] }] },
  { id: 'openai', label: 'OpenAI', access: 'api', models: [{ id: 'gpt-6-luna', label: 'GPT-6 Luna', thinking: ['low', 'medium', 'high'] }] },
];

// What the server answers for a selection: its labels from PROVIDERS.
function choiceOf(selection: ModelSelection): ModelChoice {
  const provider = PROVIDERS.find((p) => p.id === selection.provider)!;
  const modelLabel = provider.models.find((m) => m.id === selection.model)!.label;
  return { ...selection, providerLabel: provider.label, modelLabel, access: provider.access };
}

// Whether POST /api/sessions fails.
let newChatFails = false;

// Opens the New chat picker, optionally picks a provider, presses Start, and confirms when asked.
async function startNewChat(provider?: string) {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New chat' })));
  const picker = screen.getByRole('dialog', { name: 'New chat' });
  if (provider) await act(async () => void fireEvent.change(within(picker).getByRole('combobox', { name: 'Provider' }), { target: { value: provider } }));
  await act(async () => fireEvent.click(within(picker).getByRole('button', { name: 'Start' })));
  const confirm = screen.queryByRole('dialog', { name: 'Start a new chat?' });
  if (confirm) await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'New chat' })));
  await act(async () => {});
}

// The model the stored chat runs on, as GET /api/sessions/current sends it.
const HAIKU: ModelChoice = { provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium', providerLabel: 'Claude', modelLabel: 'Haiku 5.5', access: 'api' };

beforeEach(() => {
  documents = fakeDocumentsApi({ 'notes.md': '# Notes\n\nThe quick brown fox.\n', 'ideas.md': '# Ideas\n' });
  replies = [];
  chatBodies = [];
  current = { id: 's1', messages: [], running: false, model: HAIKU };
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
    if (path === '/api/models') return Response.json({ providers: PROVIDERS, selected: current.model });
    if (path === '/api/sessions') {
      if (newChatFails) return Response.json({ error: 'disk full' }, { status: 500 });
      const { selection } = JSON.parse(String(init?.body ?? '{}'));
      const model = selection ? choiceOf(selection) : current.model;
      current = { id: 's2', messages: [], running: false, model };
      return Response.json({ id: current.id, model });
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
  newChatFails = false;
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realWebSocket;
});

const chatBox = () => screen.getByRole('textbox', { name: 'Message Claude' }) as HTMLTextAreaElement;
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

test('New chat with a draft in the chat box asks first, and confirming starts a new chat with focus in the chat box', async () => {
  render(<App />);
  await act(async () => {});
  fireEvent.change(chatBox(), { target: { value: 'Half a thought' } });

  await startNewChat();

  expect(requests).toContain('POST /api/sessions');
  expect(chatBox().value).toBe('');
  expect(document.activeElement).toBe(chatBox());
});

const chip = () => document.querySelector('.chip');

test('clicking a question pill attaches its question to the chat box, and puts focus there', async () => {
  const view = await afterTurn(highlightQ1);

  await act(async () => fireEvent.click(pill(view)));

  expect(chip()!.textContent).toContain('Is the fox too plain?');
  expect(document.activeElement).toBe(chatBox());
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('an answer sent from the chat box with a question chip reaches Claude labeled, and shows as the writer’s', async () => {
  const view = await afterTurn(highlightQ1);
  await act(async () => fireEvent.click(pill(view)));
  replies.push(heldTurn().reply);

  fireEvent.change(chatBox(), { target: { value: 'Keep it, but shorter.' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });
  await act(async () => {});

  expect(chatBodies.at(-1)?.text).toBe('Q1 — Keep it, but shorter.');
  expect([...view.container.querySelectorAll('.msg.user')].at(-1)?.textContent).toBe('Q1 — Keep it, but shorter.');
  expect(chip()).toBeNull();
});

test('a turn whose highlights drop the question folds its label into what the writer typed, and the chip goes', async () => {
  const view = await afterTurn(highlightQ1);
  const turn = heldTurn();
  replies.push(turn.reply);
  fireEvent.change(chatBox(), { target: { value: 'Is the ending too long?' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });
  await act(async () => fireEvent.click(pill(view)));

  fireEvent.change(chatBox(), { target: { value: ' Keep it, but shorter. ' } });
  await act(async () => turn.finish(finishedTurn({ aborted: false, edited: {}, highlights: { file: 'notes.md', passages: [{ quote: 'quick brown' }] } })));
  await act(async () => {});

  expect(chip()).toBeNull();
  expect(chatBox().value).toBe('Q1 — Keep it, but shorter.');
});

test('a question chip removed by a change to the highlights is announced to screen readers', async () => {
  const view = await afterTurn(highlightQ1);
  await act(async () => fireEvent.click(pill(view)));

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dismiss review' })));

  expect(chip()).toBeNull();
  expect(statusRegion()).toBe("The question chip was removed because Claude's highlights changed.");
});

test('a turn whose highlights keep the question keeps its chip', async () => {
  const view = await afterTurn(highlightQ1);
  const turn = heldTurn();
  replies.push(turn.reply);
  fireEvent.change(chatBox(), { target: { value: 'Is the ending too long?' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });
  await act(async () => fireEvent.click(pill(view)));

  await act(async () => turn.finish(highlightQ1));
  await act(async () => {});

  expect(chip()!.textContent).toContain('Q1');
});

// A turn that has sent `parts` and is still running.
const runningTurn = (parts: object[]) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join('')));
    },
  });

test('an edit shows in the editor, highlighted, while the turn that made it is still running', async () => {
  const progress = { edited: { 'notes.md': '# Notes\n\nThe slow red fox.\n' }, highlights: { file: 'notes.md', passages: [{ quote: 'slow red' }] } };
  const view = await afterTurn(runningTurn([{ type: 'start' }, { type: 'data-progress', data: progress, transient: true }]) as unknown as object[]);

  expect(view.container.querySelector('.ProseMirror')?.textContent).toContain('The slow red fox.');
  expect([...view.container.querySelectorAll('mark.ai-highlight')].map((mark) => mark.textContent)).toEqual(['slow red']);
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

// Opens notes.md and selects "quick brown" in it.
async function selectQuickBrown(view: ReturnType<typeof render>) {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^notes\.md/ })));
  const editor = view.container.querySelector('.ProseMirror') as HTMLElement;
  await act(async () => editor.focus());
  const text = [...editor.querySelectorAll('p')].find((p) => p.textContent === 'The quick brown fox.')!.firstChild!;
  await act(async () => {
    document.getSelection()!.setBaseAndExtent(text, 4, text, 15);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const askButton = () => screen.getByRole('button', { name: /^Ask .* about the selection$/ });

test('asking about a selection attaches it to the chat box, and what the writer types there reaches Claude with it quoted', async () => {
  const view = render(<App />);
  await act(async () => {});
  await selectQuickBrown(view);

  await act(async () => fireEvent.click(askButton()));
  expect(chip()!.textContent).toContain('quick brown');
  fireEvent.change(chatBox(), { target: { value: 'Too plain?' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });
  await act(async () => {});

  expect(chatBodies.at(-1)?.text).toBe('About this passage:\n\n> quick brown\n\nToo plain?');
  expect(chip()).toBeNull();
});

test('a selection chip stays through a change to the highlights', async () => {
  const view = render(<App />);
  await act(async () => {});
  replies.push(finishedTurn({ aborted: false, edited: {}, highlights: { file: 'notes.md', passages: [{ quote: 'Notes' }] } }));
  fireEvent.change(chatBox(), { target: { value: 'Ask me about the title' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });
  await act(async () => {});
  await selectQuickBrown(view);
  await act(async () => fireEvent.click(askButton()));

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dismiss review' })));

  expect(chip()!.textContent).toContain('quick brown');
});

test('with no post open the chat box asks about nothing in particular, and with one open, about the post', async () => {
  render(<App />);
  await act(async () => {});
  expect(chatBox().placeholder).toBe('Ask Claude…');

  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^notes\.md/ })));

  expect(chatBox().placeholder).toBe('Ask Claude about this post…');
});

test('New post in the empty editor opens the new file dialog', async () => {
  render(<App />);
  await act(async () => {});

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New post' })));

  expect(document.querySelector('dialog.name[open]')).toBeTruthy();
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

test('dragging the bar between the Documents tree and the editor resizes the tree', async () => {
  const view = render(<App />);
  await act(async () => {});
  const treeWidth = () => (view.container.querySelector('.main') as HTMLElement).style.getPropertyValue('--tree-width');
  expect(treeWidth()).toBe('170px');

  const bar = screen.getByRole('separator', { name: 'Resize the Posts list' });
  await act(async () => fireEvent.pointerDown(bar, { clientX: 170, button: 0 }));
  await act(async () => fireEvent.pointerMove(window, { clientX: 250 }));
  await act(async () => fireEvent.pointerUp(window, { clientX: 250 }));

  expect(treeWidth()).toBe('250px');
});

test('dragging the bar between the editor and the chat panel to the left widens the panel', async () => {
  const view = render(<App />);
  await act(async () => {});
  const panelWidth = () => (view.container.querySelector('.main') as HTMLElement).style.getPropertyValue('--agent-width');
  expect(panelWidth()).toBe('400px');

  const bar = screen.getByRole('separator', { name: 'Resize the chat panel' });
  await act(async () => fireEvent.pointerDown(bar, { clientX: 1000, button: 0 }));
  await act(async () => fireEvent.pointerMove(window, { clientX: 900 }));
  await act(async () => fireEvent.pointerUp(window, { clientX: 900 }));

  expect(panelWidth()).toBe('500px');
});

const storedChat = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Fix the spelling' }] },
  { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Fixed two typos.' }] },
];

test('a reload brings back the chat, and the next message goes to the same session with only the new text', async () => {
  current = { id: 's9', messages: storedChat, running: false, model: HAIKU };
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

const statusLine = () => document.querySelector('.status-line')?.textContent;
const statusRegion = () => document.getElementById('chat-status')!.textContent;

const request = { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Tighten the intro' }] };
const reply = { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'Tightened it.' }, { type: 'data-session', data: { aborted: false, edited: {} } }] };

test('a reload while the AI works shows it working, and its reply arrives when this session’s turn finishes', async () => {
  current = { id: 's9', messages: [...storedChat, request], running: true, model: HAIKU };
  render(<App />);
  await act(async () => {});
  await act(async () => sockets[0].open());

  expect(statusLine()).toBe('Claude is working…');
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();

  await act(async () => sockets[0].send({ type: 'turn-finished', sessionId: 'other', aborted: false }));
  expect(statusLine()).toBe('Claude is working…');

  current = { id: 's9', messages: [...storedChat, request, reply], running: false, model: HAIKU };
  await act(async () => sockets[0].send({ type: 'turn-finished', sessionId: 's9', aborted: false }));
  await act(async () => {});

  expect(screen.getByText('Tightened it.')).toBeTruthy();
  expect(statusLine()).toBeUndefined();
  expect(chatSend()).toBeTruthy();
});

test('a turn that finished before the events socket connected is still picked up', async () => {
  current = { id: 's9', messages: [...storedChat, request], running: true, model: HAIKU };
  render(<App />);
  await act(async () => {});

  current = { id: 's9', messages: [...storedChat, request, reply], running: false, model: HAIKU };
  await act(async () => sockets[0].open());
  await act(async () => {});

  expect(screen.getByText('Tightened it.')).toBeTruthy();
  expect(statusLine()).toBeUndefined();
});

test('Stop while waiting on a turn begun before the reload cancels it on the server', async () => {
  current = { id: 's9', messages: [...storedChat, request], running: true, model: HAIKU };
  render(<App />);
  await act(async () => {});

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })));

  expect(requests).toContain('POST /api/sessions/s9/cancel');
});

test('a turn that finished while the page was loading its chat, with the socket already open, is still picked up', async () => {
  current = { id: 's9', messages: [...storedChat, request], running: true, model: HAIKU };
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

  current = { id: 's9', messages: [...storedChat, request, reply], running: false, model: HAIKU };
  await act(async () => loaded());
  await act(async () => {});

  expect(screen.getByText('Tightened it.')).toBeTruthy();
});

test('New chat clears Claude’s highlights and the Undo all offer', async () => {
  storedView = { ...storedView, current: 'notes.md' };
  const view = await afterTurn(finishedTurn({ aborted: false, edited: { 'notes.md': '# Notes\n\nThe slow brown fox.\n' }, highlights: { file: 'notes.md', passages: [{ quote: 'slow brown' }] } }));
  expect(view.container.querySelector('.review-strip')).toBeTruthy();

  await startNewChat();

  expect(view.container.querySelector('.review-strip')).toBeNull();
  expect(view.container.querySelector('mark.ai-highlight')).toBeNull();
});

test('Undo all is announced to screen readers once it has put the posts back', async () => {
  storedView = { ...storedView, current: 'notes.md' };
  await afterTurn(finishedTurn({ aborted: false, edited: { 'notes.md': '# Notes\n\nThe slow brown fox.\n' } }));

  await act(async () => fireEvent.click(screen.getByRole('button', { name: "Undo Claude's changes in notes.md" })));
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo changes' })));
  await act(async () => {});

  expect(statusRegion()).toBe("Undid Claude's changes in 1 post.");
});

test('a chat that cannot be loaded says why, and New chat starts a new one', async () => {
  const answer = globalThis.fetch;
  globalThis.fetch = mock(async (url: string, init?: RequestInit) =>
    String(url) === '/api/sessions/current' ? Response.json({ error: 'the server is out of memory' }, { status: 500 }) : answer(url, init),
  ) as unknown as typeof fetch;
  render(<App />);
  await act(async () => {});

  expect(screen.getByRole('alert').textContent).toBe('Could not load the chat: the server is out of memory');
  expect(screen.getByRole('alert').className).toBe('notice error');
  await startNewChat();
  expect(screen.queryByText(/Could not load the chat/)).toBeNull();
  expect(chatBox()).toBeTruthy();
});

test('a page that waited on a turn through a reload takes in its edits once it finishes, and only once', async () => {
  storedView = { ...storedView, current: 'notes.md' };
  current = { id: 's9', messages: [...storedChat, request], running: true, model: HAIKU };
  render(<App />);
  await act(async () => {});
  await act(async () => sockets[0].open());

  const edited = { ...reply, parts: [{ type: 'data-session', data: { aborted: false, edited: { 'notes.md': '# Notes\n\nThe slow red fox.\n' } } }] };
  current = { id: 's9', messages: [...storedChat, request, edited], running: false, model: HAIKU };
  await act(async () => sockets[0].send({ type: 'turn-finished', sessionId: 's9', aborted: false }));
  await act(async () => {});
  await act(async () => sockets[0].send({ type: 'turn-finished', sessionId: 's9', aborted: false }));
  await act(async () => {});

  const paragraphs = [...document.querySelectorAll('.ProseMirror p')].map((p) => p.textContent);
  expect(paragraphs).toEqual(['The slow red fox.']);
  expect(document.querySelector('.editor-bar .name')?.textContent).toBe('notes.md');
});

// The names the Documents tree shows, in order.
const treeRows = () =>
  within(screen.getByRole('list', { name: 'Posts' }))
    .getAllByRole('button')
    .filter((b) => b.classList.contains('name'))
    .map((b) => b.textContent);

test('files and folders made on disk show in the Documents tree when the server says the documents changed', async () => {
  documents.folders.add('drafts');
  render(<App />);
  await act(async () => {});
  await act(async () => sockets[0].open());
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'drafts' })));
  documents.folders.add('archive');
  documents.files.set('drafts/soil.md', '# Soil\n');

  await act(async () => sockets[0].send({ type: 'documents-changed' }));
  await act(async () => {});

  expect(treeRows()).toEqual(['archive', 'drafts', 'soil.md', 'ideas.md', 'notes.md']);
});

const banner = () => screen.queryByText(/Lost touch with 3pitor/);

test('a banner says the page lost touch with 3pitor, only while it has', async () => {
  render(<App />);
  await act(async () => {});
  expect(banner()).toBeNull();

  await act(async () => sockets[0].open());
  expect(banner()).toBeNull();

  await act(async () => sockets[0].onclose?.());
  expect(banner()!.getAttribute('role')).toBe('alert');
  expect(banner()!.textContent).toBe('Lost touch with 3pitor. Is it still running in your terminal? Trying again…');

  await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 2000 });
  await act(async () => sockets[1].open());
  expect(banner()).toBeNull();
});

test('getting back in touch with 3pitor is announced to screen readers', async () => {
  render(<App />);
  await act(async () => {});
  await act(async () => sockets[0].open());
  expect(statusRegion()).toBe('');

  await act(async () => sockets[0].onclose?.());
  await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 2000 });
  await act(async () => sockets[1].open());

  expect(statusRegion()).toBe('Reconnected to 3pitor.');
});

test('the page has no top bar: its name heads the Posts list', async () => {
  const view = render(<App />);
  await act(async () => {});

  expect(view.container.querySelector('.topbar')).toBeNull();
  expect(screen.queryByText(/events (dis)?connected/)).toBeNull();
  expect(within(view.container.querySelector('.files')!).getByRole('heading', { level: 1 }).textContent).toBe('3pitor');
});

test('the page catches up with the disk each time the events socket connects, missed events and all', async () => {
  render(<App />);
  await act(async () => {});
  const listReads = () => documents.requests.filter((r) => r === 'GET /api/documents').length;
  const loaded = listReads();

  await act(async () => sockets[0].open());
  await act(async () => {});
  expect(listReads()).toBe(loaded + 1);

  await act(async () => sockets[0].onclose?.());
  await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 2000 });
  await act(async () => sockets[1].open());
  await act(async () => {});
  expect(listReads()).toBe(loaded + 2);
});

test('clicking the post header’s file name opens the folders around it in Posts and shows its row as the active one', async () => {
  documents.files.set('drafts/2026/seeds.md', '# Seeds\n');
  render(<App />);
  await act(async () => {});
  const click = (name: string) => act(async () => fireEvent.click(screen.getByRole('button', { name })));
  await click('drafts');
  await click('2026');
  await click('seeds.md');
  await click('drafts');
  expect(treeRows()).toEqual(['drafts', 'ideas.md', 'notes.md']);

  await click('Show seeds.md in Posts');

  expect(treeRows()).toEqual(['drafts', '2026', 'seeds.md', 'ideas.md', 'notes.md']);
  expect(screen.getByRole('button', { name: 'seeds.md' }).parentElement!.classList.contains('active')).toBe(true);
});

test('the header shows the model the loaded chat runs on', async () => {
  render(<App />);
  await act(async () => {});

  expect(screen.getAllByRole('heading').map((h) => h.textContent)).toContain('Claude');
  expect(screen.getByText('Haiku 5.5 · medium thinking')).toBeTruthy();
});

test('a new chat starts on the provider chosen in the picker, and the header shows it', async () => {
  render(<App />);
  await act(async () => {});

  await startNewChat('openai');

  expect(requests).toContain('POST /api/sessions');
  expect(screen.getAllByRole('heading').map((h) => h.textContent)).toContain('OpenAI');
  expect(screen.getByText('GPT-6 Luna · medium thinking')).toBeTruthy();
});

test('when a new chat cannot start, the picker says why, and the old chat and Claude’s review stay', async () => {
  storedView = { ...storedView, current: 'notes.md' };
  const view = await afterTurn(finishedTurn({ aborted: false, edited: { 'notes.md': '# Notes\n\nThe slow brown fox.\n' } }));
  newChatFails = true;

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New chat' })));
  await act(async () => fireEvent.click(within(screen.getByRole('dialog', { name: 'New chat' })).getByRole('button', { name: 'Start' })));
  const confirm = screen.queryByRole('dialog', { name: 'Start a new chat?' });
  if (confirm) await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: 'New chat' })));
  await act(async () => {});

  expect(within(screen.getByRole('dialog', { name: 'New chat' })).getByRole('alert').textContent).toBe('Could not start a new chat: disk full');
  expect(view.container.querySelector('.review-strip')).toBeTruthy();
  expect(screen.getByText('/collaborative-editing notes.md')).toBeTruthy();
});

test('starting a new chat tells screen readers which model it runs on', async () => {
  render(<App />);
  await act(async () => {});

  await startNewChat('openai');

  expect(statusRegion()).toBe('New chat with OpenAI (API), GPT-6 Luna, medium thinking.');
});
