import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CurrentSession, HostEvent, ModelChoice, ModelSelection, ProviderEntry, SessionData, ViewState } from '../shared/wire';
import { App } from './app';
import { type FakePostsApi, fakePostsApi } from './components/fake-posts-api';

// The two posts every test starts with, by the fake's ids.
const NOTES = '1/p 1';
const IDEAS = '2/p 2';

const realFetch = globalThis.fetch;
const realWebSocket = globalThis.WebSocket;
// The workspace, as the documents routes serve it.
let documents: FakePostsApi;
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
const highlightQ1 = finishedTurn({ aborted: false, edited: {}, highlights: { file: NOTES, passages: [Q1] } });

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
  documents = fakePostsApi({ Notes: '# Notes\n\nThe quick brown fox.\n', Ideas: '# Ideas\n' });
  replies = [];
  chatBodies = [];
  current = { id: 's1', messages: [], running: false, model: HAIKU };
  requests = [];
  sockets = [];
  storedView = { mode: 'rendered', unsaved: [], notApplied: [] };
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (!path.startsWith('/api/posts')) requests.push(`${init?.method ?? 'GET'} ${path}`);
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

// Opens Notes from the post table. The chat only shows with a post open.
const openNotes = () => act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open Notes' })));

// Renders the page with a post open, and sends one chat message, whose turn answers with `reply`.
async function afterTurn(reply: object[]) {
  const view = render(<App />);
  await act(async () => {});
  if (!storedView.current) await openNotes();
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
  await openNotes();
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
  await act(async () => turn.finish(finishedTurn({ aborted: false, edited: {}, highlights: { file: NOTES, passages: [{ quote: 'quick brown' }] } })));
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
  const progress = { edited: { [NOTES]: '# Notes\n\nThe slow red fox.\n' }, highlights: { file: NOTES, passages: [{ quote: 'slow red' }] } };
  const view = await afterTurn(runningTurn([{ type: 'start' }, { type: 'data-progress', data: progress, transient: true }]) as unknown as object[]);

  expect(view.container.querySelector('.ProseMirror')?.textContent).toContain('The slow red fox.');
  expect([...view.container.querySelectorAll('mark.ai-highlight')].map((mark) => mark.textContent)).toEqual(['slow red']);
});

test('a turn that answers one question without highlighting keeps the other question highlighted', async () => {
  const Q2 = { quote: 'Notes', label: 'Q2', question: 'Is the title too plain?' };
  const view = await afterTurn(finishedTurn({ aborted: false, edited: {}, highlights: { file: NOTES, passages: [Q1, Q2] } }));
  replies.push(finishedTurn({ aborted: false, edited: { [NOTES]: '# Notes\n\nThe slow red fox.\n' } }));

  fireEvent.change(chatBox(), { target: { value: 'Q1 — make it slow and red' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });
  await act(async () => {});

  expect([...view.container.querySelectorAll('.ai-highlight-label')].map((el) => el.textContent)).toEqual(['Q2']);
});

// Opens Notes and selects "quick brown" in it.
async function selectQuickBrown(view: ReturnType<typeof render>) {
  // From the post table, or from the panel's heading when Notes is already open.
  const notes = screen.queryByRole('button', { name: 'Open Notes' }) ?? screen.getByRole('button', { name: 'Draft' });
  await act(async () => fireEvent.click(notes));
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
  await openNotes();
  replies.push(finishedTurn({ aborted: false, edited: {}, highlights: { file: NOTES, passages: [{ quote: 'Notes' }] } }));
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

test('with a post open, the chat box asks about the post', async () => {
  render(<App />);
  await act(async () => {});

  await openNotes();

  expect(chatBox().placeholder).toBe('Ask Claude about this post…');
});

test('New post in the empty editor asks for the new post’s title', async () => {
  render(<App />);
  await act(async () => {});

  const editor = document.querySelector('section.editor') as HTMLElement;
  await act(async () => fireEvent.click(within(editor).getByRole('button', { name: 'New post' })));

  expect(document.querySelector('dialog.name[open] h3')!.textContent).toBe('New post');
  expect(screen.getByRole('textbox', { name: 'Title' })).toBeTruthy();
});
// A new post opens holding only its title heading, so the writer's next keystrokes belong in it.

// A new post opens empty, so the writer's next keystrokes belong in it.
test('New post makes the post, opens it, and puts focus in its editor', async () => {
  render(<App />);
  await act(async () => {});
  const editor = document.querySelector('section.editor') as HTMLElement;
  await act(async () => fireEvent.click(within(editor).getByRole('button', { name: 'New post' })));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Garden' } });

  await act(async () => fireEvent.submit(document.querySelector('dialog.name[open] form')!));
  await act(async () => {});

  expect(document.querySelector('.editor-bar .name')?.textContent).toBe('Garden');
  // The header draws above the panels, outside section.editor, and the post's name in it can hold focus too.
  expect(document.activeElement?.closest('section.editor, .editor-bar')).toBeTruthy();
});

test('while the AI works, posts cannot be made, renamed, or deleted, and documents still open', async () => {
  render(<App />);
  await act(async () => {});
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open Notes' })));
  const turn = heldTurn();
  replies.push(turn.reply);
  fireEvent.change(chatBox(), { target: { value: 'Tidy up my notes' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });

  // The panel goes with the landing page and comes back with the post, so it is looked up each time.
  const actions = () => within(document.querySelector('aside.files') as HTMLElement).getByRole('button', { name: 'Actions for Notes' }) as HTMLButtonElement;
  expect(actions().disabled).toBe(true);
  expect(document.getElementById('tree-paused')!.textContent).toBe(
    'Renaming and deleting are paused while Claude works. You can still open, edit, and save.',
  );
  // The landing page's New post waits too, pointing at the table's line that says why.
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Your posts' })));
  const tableNewPost = within(document.querySelector('section.editor') as HTMLElement).getByRole('button', { name: 'New post' }) as HTMLButtonElement;
  expect(tableNewPost.disabled).toBe(true);
  expect(document.getElementById(tableNewPost.getAttribute('aria-describedby')!)!.textContent).toBe(
    'New posts, renaming, and deleting are paused while Claude works. You can still open posts.',
  );
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open Notes' })));
  expect(screen.getByText('Tidy up my notes')).toBeTruthy();
  expect(document.querySelector('.editor-bar .name')?.textContent).toBe('Notes');

  await act(async () => turn.finish(finishedTurn({ aborted: false, edited: {} })));
  await act(async () => {});
  expect(actions().disabled).toBe(false);
});

test('dragging the bar between the post panel and the editor resizes the panel', async () => {
  const view = render(<App />);
  await act(async () => {});
  await openNotes();
  const treeWidth = () => (view.container.querySelector('.main') as HTMLElement).style.getPropertyValue('--tree-width');
  expect(treeWidth()).toBe('300px');

  const bar = screen.getByRole('separator', { name: 'Resize the post panel' });
  await act(async () => fireEvent.pointerDown(bar, { clientX: 300, button: 0 }));
  await act(async () => fireEvent.pointerMove(window, { clientX: 380 }));
  await act(async () => fireEvent.pointerUp(window, { clientX: 380 }));

  expect(treeWidth()).toBe('380px');
});

test('dragging the bar between the editor and the chat panel to the left widens the panel', async () => {
  const view = render(<App />);
  await act(async () => {});
  await openNotes();
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
  await openNotes();

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
  await openNotes();
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
  await openNotes();

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
  await openNotes();

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
  await openNotes();

  expect(screen.getByText('Tightened it.')).toBeTruthy();
});

test('New chat clears Claude’s highlights and the Undo all offer', async () => {
  storedView = { ...storedView, current: NOTES };
  const view = await afterTurn(finishedTurn({ aborted: false, edited: { [NOTES]: '# Notes\n\nThe slow brown fox.\n' }, highlights: { file: NOTES, passages: [{ quote: 'slow brown' }] } }));
  expect(view.container.querySelector('.review-strip')).toBeTruthy();

  await startNewChat();

  expect(view.container.querySelector('.review-strip')).toBeNull();
  expect(view.container.querySelector('mark.ai-highlight')).toBeNull();
});

test('Undo all is announced to screen readers once it has put the posts back', async () => {
  storedView = { ...storedView, current: NOTES };
  await afterTurn(finishedTurn({ aborted: false, edited: { [NOTES]: '# Notes\n\nThe slow brown fox.\n' } }));

  await act(async () => fireEvent.click(screen.getByRole('button', { name: "Undo Claude's changes in Notes" })));
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
  await openNotes();

  expect(screen.getByRole('alert').textContent).toBe('Could not load the chat: the server is out of memory');
  expect(screen.getByRole('alert').className).toBe('notice error');
  await startNewChat();
  expect(screen.queryByText(/Could not load the chat/)).toBeNull();
  expect(chatBox()).toBeTruthy();
});

test('a page that waited on a turn through a reload takes in its edits once it finishes, and only once', async () => {
  storedView = { ...storedView, current: NOTES };
  current = { id: 's9', messages: [...storedChat, request], running: true, model: HAIKU };
  render(<App />);
  await act(async () => {});
  await act(async () => sockets[0].open());

  const edited = { ...reply, parts: [{ type: 'data-session', data: { aborted: false, edited: { [NOTES]: '# Notes\n\nThe slow red fox.\n' } } }] };
  current = { id: 's9', messages: [...storedChat, request, edited], running: false, model: HAIKU };
  await act(async () => sockets[0].send({ type: 'turn-finished', sessionId: 's9', aborted: false }));
  await act(async () => {});
  await act(async () => sockets[0].send({ type: 'turn-finished', sessionId: 's9', aborted: false }));
  await act(async () => {});

  const paragraphs = [...document.querySelectorAll('.ProseMirror p')].map((p) => p.textContent);
  expect(paragraphs).toEqual(['The slow red fox.']);
  expect(document.querySelector('.editor-bar .name')?.textContent).toBe('Notes');
});

// The titles the post table shows, in order.
const tableRows = () =>
  within(screen.getByRole('table', { name: 'Your posts' }))
    .getAllByRole('button', { name: /^Open / })
    .map((b) => b.textContent);

test('posts made elsewhere show in the post table, by title, when the server says the posts changed', async () => {
  render(<App />);
  await act(async () => {});
  await act(async () => sockets[0].open());
  documents.add('Soil', '# Soil\n');
  documents.add('Archive', '');

  await act(async () => sockets[0].send({ type: 'posts-changed' }));
  await act(async () => {});

  expect(tableRows()).toEqual(['Open Archive', 'Open Ideas', 'Open Notes', 'Open Soil']);
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

test('the page has no top bar: its name heads the editor’s bar, with nothing open and with a post open', async () => {
  const view = render(<App />);
  await act(async () => {});

  expect(view.container.querySelector('.topbar')).toBeNull();
  expect(screen.queryByText(/events (dis)?connected/)).toBeNull();
  const title = () => within(view.container.querySelector('.editor-bar')!).getByRole('heading', { level: 1 }).textContent;
  expect(title()).toBe('3pitor');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open Notes' })));
  expect(title()).toBe('3pitor');
  expect(within(view.container.querySelector('.files')!).queryByRole('heading', { level: 1 })).toBeNull();
});

// The header spans the window above both panels, so Tab and a screen reader reach it before the post panel.
test('with a post open, the header comes before the post panel', async () => {
  const view = render(<App />);
  await act(async () => {});
  await openNotes();

  const header = view.container.querySelector('.editor-bar')!;
  const panel = view.container.querySelector('aside.files')!;
  expect(header.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

// The formatting toolbar spans the window under the header, so the panels start below it too.
test('with a post open, the formatting toolbar comes after the header and before the post panel', async () => {
  const view = render(<App />);
  await act(async () => {});
  await openNotes();

  const header = view.container.querySelector('.editor-bar')!;
  const toolbar = view.container.querySelector('.ProseMirror-menubar')!;
  const panel = view.container.querySelector('aside.files')!;
  expect(header.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(toolbar.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

// The header draws outside the editor, and the focus moves it shares with the editor still land.
test('opening a post puts focus on its name in the header, and Home puts it in the post table’s search box', async () => {
  render(<App />);
  await act(async () => {});

  await openNotes();
  const header = document.querySelector('.editor-bar') as HTMLElement;
  expect(document.activeElement).toBe(within(header).getByRole('heading', { name: 'Notes', level: 2 }));

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Your posts' })));
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search posts' }));
});

// The landing page is the post table alone: nothing in the side panels is about a post, and the chat is about one.
test('with no post open, the page shows neither the post panel, the Content Outline box, nor the chat, which come back when a post opens', async () => {
  const view = render(<App />);
  await act(async () => {});
  const panels = () => ({
    posts: view.container.querySelector('aside.files') !== null,
    outline: view.container.querySelector('aside.headings') !== null,
    chat: view.container.querySelector('section.side') !== null,
    resizers: screen.queryAllByRole('separator', { name: /^Resize the / }).length,
  });

  expect(panels()).toEqual({ posts: false, outline: false, chat: false, resizers: 0 });
  expect(screen.getByRole('table', { name: 'Your posts' })).toBeTruthy();

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open Notes' })));
  expect(panels()).toEqual({ posts: true, outline: true, chat: true, resizers: 2 });

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Your posts' })));
  expect(panels()).toEqual({ posts: false, outline: false, chat: false, resizers: 0 });
});

// Unsaved text whose post was deleted elsewhere is reached only from the post panel, so the panel stays to hold it.
test('with no post open, the post panel still shows when it holds unsaved changes with nowhere to be saved', async () => {
  const view = await afterTurn(finishedTurn({ aborted: false, edited: { [NOTES]: '# Notes\n\nThe slow brown fox.\n' } }));
  documents.titles.delete(NOTES);
  await act(async () => sockets[0].send({ type: 'posts-changed' }));
  await act(async () => {});

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Your posts' })));

  expect(screen.getByRole('table', { name: 'Your posts' })).toBeTruthy();
  const panel = view.container.querySelector('aside.files') as HTMLElement;
  expect(within(panel).getByRole('button', { name: / — unsaved, not in your posts$/ })).toBeTruthy();
  expect(within(screen.getByRole('complementary', { name: 'Content Outline' })).getByText('No file open.')).toBeTruthy();
  expect(view.container.querySelector('section.side')).toBeNull();
});

// The rows of the Content Outline box's list, as read aloud.
const outlineRows = () => within(screen.getByRole('list', { name: 'Headings in this file' })).getAllByRole('listitem').map((row) => row.textContent);

test('a heading typed in the Markdown view shows in the Content Outline box as it is typed', async () => {
  render(<App />);
  await act(async () => {});
  await openNotes();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Markdown' })));

  const markdown = document.querySelector<HTMLTextAreaElement>('textarea.raw-markdown')!;
  await act(async () => fireEvent.change(markdown, { target: { value: `${markdown.value}\n## Pricing\n` } }));

  expect(outlineRows()).toEqual(['Level 1, Notes', 'Level 2, Pricing']);
});

test('a heading Claude adds to the open file shows in the Content Outline box', async () => {
  await afterTurn(finishedTurn({ aborted: false, edited: { [NOTES]: '# Notes\n\n## Pricing\n\nThe quick brown fox.\n' } }));

  expect(outlineRows()).toEqual(['Level 1, Notes', 'Level 2, Pricing']);
});

test('choosing a heading in the Content Outline box brings it into view in the editor', async () => {
  await afterTurn(finishedTurn({ aborted: false, edited: { [NOTES]: '# Notes\n\nThe quick brown fox.\n\n## Pricing\n\nFree.\n' } }));
  const scrolled: string[] = [];
  const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    scrolled.push(this.textContent ?? '');
  });

  await act(async () => fireEvent.click(within(screen.getByRole('complementary', { name: 'Content Outline' })).getByRole('button', { name: 'Level 2, Pricing' })));

  scroll.mockRestore();
  expect(scrolled).toEqual(['Pricing']);
});

test('a post opened after choosing a heading in the Content Outline box opens where it starts', async () => {
  await afterTurn(finishedTurn({ aborted: false, edited: {} }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Level 1, Notes' })));
  const scrolled: string[] = [];
  const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    if (this.closest('.rich-editor')) scrolled.push(this.textContent ?? '');
  });

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Your posts' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open Ideas' })));

  scroll.mockRestore();
  expect(scrolled).toEqual([]);
});

test('the page catches up with the disk each time the events socket connects, missed events and all', async () => {
  render(<App />);
  await act(async () => {});
  const listReads = () => documents.requests.filter((r) => r === 'GET /api/posts').length;
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

test('the header shows the model the loaded chat runs on', async () => {
  render(<App />);
  await act(async () => {});
  await openNotes();

  expect(screen.getAllByRole('heading').map((h) => h.textContent)).toContain('Claude');
  expect(screen.getByText('Haiku 5.5 · medium thinking')).toBeTruthy();
});

test('a new chat starts on the provider chosen in the picker, and the header shows it', async () => {
  render(<App />);
  await act(async () => {});
  await openNotes();

  await startNewChat('openai');

  expect(requests).toContain('POST /api/sessions');
  expect(screen.getAllByRole('heading').map((h) => h.textContent)).toContain('OpenAI');
  expect(screen.getByText('GPT-6 Luna · medium thinking')).toBeTruthy();
});

test('when a new chat cannot start, the picker says why, and the old chat and Claude’s review stay', async () => {
  storedView = { ...storedView, current: NOTES };
  const view = await afterTurn(finishedTurn({ aborted: false, edited: { [NOTES]: '# Notes\n\nThe slow brown fox.\n' } }));
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
  await openNotes();

  await startNewChat('openai');

  expect(statusRegion()).toBe('New chat with OpenAI (API), GPT-6 Luna, medium thinking.');
});
