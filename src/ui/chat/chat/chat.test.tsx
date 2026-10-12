import { afterEach, beforeEach, expect, jest, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { SessionData, TurnProgress } from '../../../shared/wire';
import { Chat, composeMessage, toolLine, useChatSession, workingFile, type ChatSession } from './chat';

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

test('a new chat says how Claude edits, and offers each action as a suggestion with its hint', () => {
  renderChat();

  expect(screen.getByText("Claude edits right in your post. Its changes show up as unsaved, so nothing is written until you save.")).toBeTruthy();
  expect(screen.getByText('Try')).toBeTruthy();
  const suggestions = [...document.querySelectorAll('.suggestions button')].map((b) => b.textContent);
  expect(suggestions).toEqual([
    'ProofreadFix spelling, grammar and typos',
    'Edit togetherGo through the post section by section',
    'ResearchCheck claims and find sources',
  ]);
});

test('a suggestion puts its skill in the chat box, with focus there and the caret at the end', () => {
  renderChat();

  fireEvent.click(screen.getByRole('button', { name: /^Edit together/ }));

  expect(box().value).toBe('/collaborative-editing ');
  expect(document.activeElement).toBe(box());
  expect(box().selectionStart).toBe('/collaborative-editing '.length);
});

test('a chat with messages offers no suggestions', async () => {
  renderChat();

  await typeAndSend('Fix the spelling');
  await act(async () => {});

  expect(document.querySelector('.suggestions')).toBeNull();
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

test('hands each edit the turn reports to the editor while the turn is still running', async () => {
  const onTurnProgress = mock((_data: TurnProgress) => {});
  const progress = { edited: { 'notes.md': '# Notes kept\n' }, highlights: { file: 'notes.md', passages: [{ quote: 'kept' }] } };
  globalThis.fetch = mock(async () => {
    const chunks = [{ type: 'start' }, { type: 'data-progress', data: progress, transient: true }];
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')));
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  renderChat({ onTurnProgress });

  await typeAndSend('Keep it');
  await act(async () => {});

  expect(onTurnProgress.mock.calls).toEqual([[progress]]);
});

test('a failed turn is reported as an error notice that screen readers announce', async () => {
  reply = [{ type: 'start' }, { type: 'error', errorText: 'the model is overloaded' }];
  renderChat();

  await typeAndSend('Keep it');
  await act(async () => {});

  const alert = screen.getByRole('alert');
  expect(alert.className).toBe('notice error');
  expect(alert.textContent).toBe('the model is overloaded');
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

// The chip context, as a pill and a selection attach it.
const Q1 = { kind: 'question' as const, passage: { quote: 'quick brown', label: 'Q1', question: 'Is the fox too plain?' } };
const QUICK = { kind: 'selection' as const, markdown: 'quick brown' };

test('a message with no chip is sent as typed', () => {
  expect(composeMessage('  Fix it\n')).toBe('  Fix it\n');
});

test('a message about a question starts with its label, the answer trimmed', () => {
  expect(composeMessage('  Keep it, but shorter.\n', Q1)).toBe('Q1 — Keep it, but shorter.');
});

test('a message about a selection quotes every line of it, then says what the writer asked', () => {
  expect(composeMessage('  Too plain?\n', { kind: 'selection', markdown: '# Plan\n\nThe fox.' })).toBe(
    'About this passage:\n\n> # Plan\n>\n> The fox.\n\nToo plain?',
  );
});

// The chat with a session the test can reach, as the page holds it.
function chatWithSession() {
  const session = { current: undefined as unknown as ChatSession };
  const view = renderChat({ onSession: (chat) => (session.current = chat) });
  return { session, view };
}

const removeChip = (name: string) => screen.getByRole('button', { name });

test('attaching a passage shows it as a chip above the chat box, describes the box with it, and puts focus there', () => {
  const { session } = chatWithSession();

  act(() => session.current.attach(QUICK));

  const chip = document.querySelector('.chip')!;
  expect(chip.textContent).toContain('quick brown');
  expect(document.getElementById(box().getAttribute('aria-describedby')!)!.textContent).toContain('quick brown');
  expect(removeChip('Remove selected passage')).toBeTruthy();
  expect(document.activeElement).toBe(box());
});

test('a question chip shows its label and question', () => {
  const { session } = chatWithSession();

  act(() => session.current.attach(Q1));

  expect(document.querySelector('.chip')!.textContent).toContain('Q1');
  expect(document.querySelector('.chip')!.textContent).toContain('Is the fox too plain?');
  expect(removeChip('Remove Q1')).toBeTruthy();
});

test('sending with a chip sends the composed message, and clears the chip and the box', async () => {
  const { session } = chatWithSession();
  act(() => session.current.attach(QUICK));

  await typeAndSend('Too plain?');

  expect(chatBodies.map((b: any) => b.text)).toEqual(['About this passage:\n\n> quick brown\n\nToo plain?']);
  expect(document.querySelector('.chip')).toBeNull();
  expect(box().value).toBe('');
});

test('a blank message with a chip sends nothing, and keeps the chip', async () => {
  const { session } = chatWithSession();
  act(() => session.current.attach(Q1));

  await typeAndSend('   ');

  expect(chatBodies).toEqual([]);
  expect(document.querySelector('.chip')).toBeTruthy();
});

test('a message with a chip sent while a turn is running keeps both the box and the chip', async () => {
  holdTurnOpen({ aborted: false, edited: {} });
  const { session } = chatWithSession();
  await typeAndSend('Keep it');
  act(() => session.current.attach(Q1));
  fireEvent.change(box(), { target: { value: 'Shorter' } });

  let sent = true;
  await act(async () => {
    sent = session.current.send('Shorter');
  });

  expect(sent).toBe(false);
  expect(box().value).toBe('Shorter');
  expect(document.querySelector('.chip')).toBeTruthy();
});

test('removing the chip takes it away and puts focus in the chat box', () => {
  const { session } = chatWithSession();
  act(() => session.current.attach(QUICK));
  removeChip('Remove selected passage').focus();

  act(() => fireEvent.click(removeChip('Remove selected passage')));

  expect(document.querySelector('.chip')).toBeNull();
  expect(box().getAttribute('aria-describedby')).toBeNull();
  expect(document.activeElement).toBe(box());
});

test('attaching another passage replaces the chip', () => {
  const { session } = chatWithSession();
  act(() => session.current.attach(QUICK));

  act(() => session.current.attach(Q1));

  expect(document.querySelectorAll('.chip')).toHaveLength(1);
  expect(session.current.context).toEqual(Q1);
});

test('a new chat starts with no chip', () => {
  const { session, view } = chatWithSession();
  act(() => session.current.attach(QUICK));

  view.rerender(<ChatFor chat={chatWithId('s2')} onSession={(chat) => (session.current = chat)} />);

  expect(session.current.context).toBeUndefined();
  expect(document.querySelector('.chip')).toBeNull();
});

const actionsButton = () => screen.getByRole('button', { name: 'Actions' });

test('the Actions button says Actions', () => {
  renderChat();

  expect(actionsButton().textContent).toBe('Actions');
});

test('choosing Edit together from the Actions menu puts its skill in the chat box, with focus there', () => {
  renderChat();

  fireEvent.click(actionsButton());
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit together' }));

  expect(box().value).toBe('/collaborative-editing ');
  expect(document.activeElement).toBe(box());
});

test('the Actions menu closes once an action is chosen', () => {
  renderChat();

  fireEvent.click(actionsButton());
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit together' }));

  expect(screen.queryByRole('menu')).toBeNull();
});

test('choosing Proofread from the Actions menu puts its skill in the chat box', () => {
  renderChat();

  fireEvent.click(actionsButton());
  fireEvent.click(screen.getByRole('menuitem', { name: 'Proofread' }));

  expect(box().value).toBe('/proofread ');
});

test('choosing Research from the Actions menu puts its skill in the chat box', () => {
  renderChat();

  fireEvent.click(actionsButton());
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

  expect(document.querySelector('.status-line')!.textContent).toBe('Claude is working…');
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  let sent = true;
  await act(async () => {
    sent = chat.send('Another thing');
  });
  expect(sent).toBe(false);

  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })));
  expect(urls).toEqual(['/api/sessions/s7/cancel']);
});

// A tool call as a reply's message part.
let calls = 0;
const tool = (toolName: string, input: object = {}, state = 'output-available') =>
  ({ type: 'dynamic-tool', toolName, toolCallId: `c${++calls}`, state, input, output: '' }) as any;

test('the tool summary counts files read and edits made', () => {
  expect(toolLine([tool('Read'), tool('Read'), tool('Edit'), tool('Edit'), tool('Edit')])).toBe('Read 2 files, made 3 edits');
  expect(toolLine([tool('Read')])).toBe('Read 1 file');
});

test('the tool summary counts a write as an edit', () => {
  expect(toolLine([tool('Edit'), tool('Write')])).toBe('Made 2 edits');
});

test('the tool summary counts every other tool together', () => {
  expect(toolLine([tool('Read'), tool('Grep'), tool('Glob')])).toBe('Read 1 file, used 2 other tools');
  expect(toolLine([tool('Grep')])).toBe('Used 1 other tool');
});

test('the tool summary says so while a tool is still running', () => {
  expect(toolLine([tool('Read'), tool('Edit', {}, 'input-available')])).toBe('Read 1 file, made 1 edit (working)');
});

// A reply as the chat holds it, its parts in order.
const assistant = (parts: object[]) => ({ id: `a${++calls}`, role: 'assistant' as const, parts }) as any;

test('the file Claude is working on is the last one a tool named, as the chat shows it', () => {
  const messages = [assistant([tool('Read', { file_path: '/w/.data/workspace/notes.md' }), tool('Grep', { pattern: 'fox' }), tool('Edit', { file_path: '/w/.data/workspace/ideas.md' })])];

  expect(workingFile(messages)).toBe('ideas.md');
  expect(workingFile([assistant([tool('Grep', { pattern: 'fox' })])])).toBeUndefined();
  expect(workingFile([])).toBeUndefined();
});

test('a reply’s tools fold into one counted line, which opens to show each tool', () => {
  const reply = assistant([{ type: 'text', text: 'Looking.' }, tool('Read', { file_path: '/w/.data/workspace/notes.md' }), tool('Edit', { file_path: '/w/.data/workspace/notes.md' }), { type: 'text', text: 'Done.' }]);
  renderChat({ chat: { id: 's8', messages: [reply], waiting: false } });

  const folds = document.querySelectorAll('.msg.assistant details');
  expect(folds).toHaveLength(1);
  expect(folds[0].querySelector('summary')!.textContent).toBe('Read 1 file, made 1 edit');
  expect([...folds[0].querySelectorAll('.tool')].map((t) => t.textContent)).toEqual(['Read notes.md · done', 'Edit notes.md · done']);
  expect([...document.querySelectorAll('.msg.assistant > *')].map((el) => el.tagName)).toEqual(['DIV', 'DETAILS', 'DIV']);
});

const statusRegion = () => document.getElementById('chat-status')!;

// Answers the next chat request with `parts`, and keeps the turn running until the returned function ends it.
function runningTurn(parts: object[]) {
  let finish = () => {};
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/chat')) chatBodies.push(JSON.parse(String(init?.body)));
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join('')));
        finish = () => {
          controller.enqueue(new TextEncoder().encode(stream([{ type: 'data-session', data: { aborted: false, edited: {} } }, { type: 'finish' }])));
          controller.close();
        };
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  return () => finish();
}

test('a running turn shows one status line above the chat box, and Stop in place of Send', async () => {
  runningTurn([{ type: 'start' }]);
  renderChat();

  await typeAndSend('Keep it');

  const line = document.querySelector('.status-line')!;
  expect(line.textContent).toBe('Claude is working…');
  expect(line.nextElementSibling?.className).toBe('composer');
  expect(screen.queryByText('thinking…')).toBeNull();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
});

test('the status line names the file the latest tool is working on', async () => {
  runningTurn([{ type: 'start' }, { type: 'tool-input-available', toolCallId: 'c1', toolName: 'Read', input: { file_path: '/w/.data/workspace/notes.md' }, dynamic: true }]);
  renderChat();

  await typeAndSend('Keep it');
  await act(async () => {});

  expect(document.querySelector('.status-line')!.textContent).toBe('Claude is working on notes.md');
});

test('the status line goes once the turn finishes', async () => {
  const finish = runningTurn([{ type: 'start' }]);
  renderChat();
  await typeAndSend('Keep it');

  await act(async () => finish());
  await act(async () => {});

  expect(document.querySelector('.status-line')).toBeNull();
});

test('the status region is always in the page, and tells screen readers when Claude starts, which file it is on, and when it finishes', async () => {
  const finish = runningTurn([{ type: 'start' }, { type: 'tool-input-available', toolCallId: 'c1', toolName: 'Read', input: { file_path: '/w/.data/workspace/notes.md' }, dynamic: true }]);
  renderChat();
  expect(statusRegion().getAttribute('role')).toBe('status');
  expect(statusRegion().textContent).toBe('');

  await typeAndSend('Keep it');
  await act(async () => {});
  expect(statusRegion().textContent).toBe('Claude is working on notes.md.');

  await act(async () => finish());
  await act(async () => {});
  expect(statusRegion().textContent).toBe('Claude finished.');
});

test('the status region says Claude is working before any tool names a file', async () => {
  runningTurn([{ type: 'start' }]);
  renderChat();

  await typeAndSend('Keep it');

  expect(statusRegion().textContent).toBe('Claude is working.');
});

test('the page can tell screen readers something through the status region', () => {
  const { session } = chatWithSession();

  act(() => session.current.announce('Reconnected to 3pitor.'));

  expect(statusRegion().textContent).toBe('Reconnected to 3pitor.');
});

