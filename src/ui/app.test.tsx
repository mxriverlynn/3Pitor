import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionData } from '../shared/wire';
import { App } from './app';

const realFetch = globalThis.fetch;
const realWebSocket = globalThis.WebSocket;
// The workspace's files, as the documents routes serve them.
let disk: Map<string, string>;
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
let chatBodies: { text: string }[];

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
  disk = new Map([
    ['notes.md', '# Notes\n\nThe quick brown fox.\n'],
    ['ideas.md', '# Ideas\n'],
  ]);
  replies = [];
  chatBodies = [];
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/sessions') return Response.json({ id: 's1' });
    if (path.endsWith('/chat')) {
      chatBodies.push(JSON.parse(String(init?.body)));
      const reply = replies.shift() ?? finishedTurn({ aborted: false, edited: {} });
      return new Response(reply instanceof ReadableStream ? reply : stream(reply), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (path === '/api/documents') return Response.json({ documents: [...disk.keys()].sort() });
    const name = decodeURIComponent(path.replace('/api/documents/', ''));
    return Response.json({ name, content: disk.get(name) });
  }) as unknown as typeof fetch;
  // The host events socket never connects here.
  globalThis.WebSocket = class {
    close() {}
  } as unknown as typeof WebSocket;
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
  fireEvent.change(chatBox(), { target: { value: '/collaborative-draft-editing notes.md' } });
  await act(async () => {
    fireEvent.click(chatSend());
  });
  await act(async () => {});
  return view;
}

const pill = (view: ReturnType<typeof render>) => view.container.querySelector('.ai-highlight-label') as HTMLElement;

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

test('switching to another file and back does not bring the popup back', async () => {
  const view = await afterTurn(highlightQ1);
  await act(async () => fireEvent.click(pill(view)));

  await act(async () => fireEvent.click(screen.getByRole('button', { name: /ideas\.md/ })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /notes\.md/ })));

  expect(pill(view)).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('asking about a selection sends it through the chat, and the popup closes', async () => {
  const view = render(<App />);
  await act(async () => {});
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
