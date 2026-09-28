import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Chat } from './chat';

const realFetch = globalThis.fetch;
let chatBodies: unknown[];

// Records every chat request's body and answers with an empty stream; the tests only look at what was sent.
beforeEach(() => {
  chatBodies = [];
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/chat')) chatBodies.push(JSON.parse(String(init?.body)));
    return new Response('', { headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// A save the test finishes by hand, so it can look at the chat panel while the save is still running.
function pendingSave() {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => ((finish = resolve), (fail = reject)));
  const save = mock(() => done);
  return {
    save,
    finish: () => act(async () => finish()),
    fail: () => act(async () => fail(new Error('offline'))),
  };
}

function renderChat(openFile: string, saveOpenFile: () => Promise<void>) {
  const props = { sessionId: 's1', approvals: {}, onTurnFinished: () => {}, openFile, saveOpenFile };
  const view = render(<Chat {...props} />);
  return { rerender: (next: string) => view.rerender(<Chat {...props} openFile={next} />) };
}

const box = () => screen.getByPlaceholderText('Ask the agent to edit your document…') as HTMLTextAreaElement;

async function typeAndSend(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByText('Send'));
  });
}

test('saves the open file before sending the message with its name', async () => {
  const { save, finish } = pendingSave();
  renderChat('notes.md', save);

  await typeAndSend('Fix the spelling');
  expect(save).toHaveBeenCalledTimes(1);
  expect(chatBodies).toEqual([]);

  await finish();
  expect(chatBodies).toEqual([{ text: 'Fix the spelling', openFile: 'notes.md' }]);
});

test('keeps the message and says why when the save fails', async () => {
  const { save, fail } = pendingSave();
  renderChat('notes.md', save);

  await typeAndSend('Fix the spelling');
  await fail();

  expect(chatBodies).toEqual([]);
  expect(box().value).toBe('Fix the spelling');
  expect(screen.getByRole('alert').textContent).toBe('Could not save notes.md, so the message was not sent. Try Send again.');
});
