import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { anthropic } from '@ai-sdk/anthropic';
import { LoadAPIKeyError, type UIMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatRequest } from '../../../shared/wire';
import { MISSING_API_KEY_HELP } from '../claude-backend/claude-backend';
import { fakeClaudeOnPath } from '../claude-cli/fake-claude-on-path';
import { EventBus } from '../../events/events';
import { stateFile, writeJson } from '../../components/json-file';
import { Sessions, type SessionsOptions } from './sessions';
import { sessionRoutes } from './sessions.routes';
import { scriptedModel, useModel } from '../components/test-model';

let workspace: string;
let events: EventBus;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-sessions-'));
  await writeFile(join(workspace, 'notes.md'), '# Garden Plan\n');
  events = new EventBus();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

type Chunk = { type: string; [key: string]: any };

// Runs one chat turn and returns every UI stream chunk it produced, calling onChunk as each arrives.
async function turn(sessions: Sessions, sessionId: string, request: string | ChatRequest, onChunk?: (chunk: Chunk) => void) {
  const chunks: Chunk[] = [];
  const body = typeof request === 'string' ? { text: request } : request;
  for await (const chunk of sessions.chat(sessionId, body) as ReadableStream<Chunk>) {
    chunks.push(chunk);
    onChunk?.(chunk);
  }
  return chunks;
}

fakeClaudeOnPath();

const newSessions = (options: Partial<SessionsOptions> = {}) => new Sessions({ workspace, claude: 'api', ...options }, events);

test('a second turn sends the conversation so far', async () => {
  const model = scriptedModel('Garden Plan', 'You asked about Garden Plan.');
  useModel(model);
  const sessions = newSessions();
  const { id } = await sessions.create();

  await turn(sessions, id, 'What is the heading?');
  await turn(sessions, id, 'What did you just tell me?');

  const prompt = model.doStreamCalls[1].prompt.filter((m) => m.role !== 'system');
  expect(prompt.map((m) => [m.role, (m.content as { text: string }[])[0].text])).toEqual([
    ['user', 'What is the heading?'],
    ['assistant', 'Garden Plan'],
    ['user', 'What did you just tell me?'],
  ]);
});

test('a turn with an open file tells the model which file is open', async () => {
  const model = scriptedModel('Done.');
  useModel(model);
  const sessions = newSessions();
  const { id } = await sessions.create();

  await turn(sessions, id, { text: 'Fix the spelling', openFile: 'notes.md' });

  const [user] = model.doStreamCalls[0].prompt.filter((m) => m.role !== 'system');
  expect(user.content).toEqual([
    { type: 'text', text: 'Fix the spelling' },
    { type: 'text', text: 'The file open in my editor is notes.md. When my message does not name a file, it means this file.' },
  ]);
});

test('a turn without an open file sends only the user text', async () => {
  const model = scriptedModel('Done.');
  useModel(model);
  const sessions = newSessions();
  const { id } = await sessions.create();

  await turn(sessions, id, 'Fix the spelling');

  const [user] = model.doStreamCalls[0].prompt.filter((m) => m.role !== 'system');
  expect(user.content).toEqual([{ type: 'text', text: 'Fix the spelling' }]);
});

const editHeading = { tool: 'Edit', input: { file_path: 'notes.md', old_string: 'Garden', new_string: 'Vegetable' } };

test('an edit needs no approval: the turn reports it for the editor, and the file on disk is unchanged', async () => {
  useModel(scriptedModel([editHeading], 'Done.'));
  const sessions = newSessions();
  const { id } = await sessions.create();

  const chunks = await turn(sessions, id, 'Rename the plan');

  expect(chunks.filter((c) => c.type === 'data-approval')).toEqual([]);
  expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({ aborted: false, edited: { 'notes.md': '# Vegetable Plan\n' } });
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Garden Plan\n');
});

test('a finished turn sends the final text of each post it edited, starting from what the browser sent', async () => {
  const typed = { tool: 'Edit', input: { file_path: 'notes.md', old_string: 'typed', new_string: 'kept' } };
  useModel(scriptedModel([typed], 'Done.'));
  const sessions = newSessions();
  const { id } = await sessions.create();

  const chunks = await turn(sessions, id, { text: 'Keep it', documents: { 'notes.md': '# Garden Plan, typed\n' } });

  expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({ aborted: false, edited: { 'notes.md': '# Garden Plan, kept\n' } });
});

test('a stopped turn sends no edits', async () => {
  useModel(scriptedModel([editHeading], 'Done.'));
  const sessions = newSessions();
  const { id } = await sessions.create();

  const chunks = await turn(sessions, id, 'Rename the plan', (chunk) => {
    if (chunk.type === 'tool-output-available') sessions.cancel(id);
  });

  expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({ aborted: true, edited: {} });
});

test('a finished turn sends its last highlights for the editor; a stopped turn or one with no Highlight sends none', async () => {
  const highlight = { tool: 'Highlight', input: { file_path: 'notes.md', passages: [{ quote: 'Garden Plan', label: 'Q1' }] } };
  const sessions = newSessions();
  const { id } = await sessions.create();
  const session = async (chunks: Chunk[]) => chunks.find((c) => c.type === 'data-session')?.data;

  useModel(scriptedModel([highlight], 'Q1 — keep it?'));
  expect(await session(await turn(sessions, id, 'Review it'))).toEqual({
    aborted: false,
    edited: {},
    highlights: { file: 'notes.md', passages: [{ quote: 'Garden Plan', label: 'Q1' }] },
  });

  useModel(scriptedModel([highlight], 'Q1 — keep it?'));
  const stopped = await turn(sessions, id, 'Review it', (chunk) => {
    if (chunk.type === 'tool-output-available') sessions.cancel(id);
  });
  expect(await session(stopped)).toStrictEqual({ aborted: true, edited: {} });

  useModel(scriptedModel('Nothing to show.'));
  expect(await session(await turn(sessions, id, 'Anything?'))).toStrictEqual({ aborted: false, edited: {} });
});

test('a turn stops after the step limit', async () => {
  const readNotes = [{ tool: 'Read', input: { file_path: 'notes.md' } }];
  const model = scriptedModel(readNotes, readNotes, readNotes, 'Done.');
  useModel(model);
  const sessions = newSessions({ maxSteps: 2 });
  const { id } = await sessions.create();
  const chunks = await turn(sessions, id, 'Keep reading');
  expect(model.doStreamCalls.length).toBe(2);
  expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({ aborted: false, edited: {} });
});

test('a turn that fails shows the model error', async () => {
  useModel(scriptedModel());
  const sessions = newSessions();
  const { id } = await sessions.create();
  const chunks = await turn(sessions, id, 'Hello');
  expect(chunks.filter((c) => c.type === 'error').map((c) => c.errorText)).toContain('the script has no reply for model call 1');
});

test('a turn with no API key explains how to set one, without a stack trace', async () => {
  const missingKey = new LoadAPIKeyError({ message: 'Anthropic API key is missing.' });
  useModel(new MockLanguageModelV4({ doStream: async () => { throw missingKey; } }));
  const logged = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const sessions = newSessions();
    const { id } = await sessions.create();
    const chunks = await turn(sessions, id, 'Hello');
    expect(chunks.filter((c) => c.type === 'error').map((c) => c.errorText)).toEqual([MISSING_API_KEY_HELP]);
    expect(logged.mock.calls).toEqual([[MISSING_API_KEY_HELP]]);
  } finally {
    logged.mockRestore();
  }
});

const partsOf = (message: { parts: { type: string }[] }, type: string) => message.parts.filter((part) => part.type === type);

test('a completed turn records the user message without the open-file sentence, and the reply with its session part', async () => {
  useModel(scriptedModel([editHeading], 'Done.'));
  const sessions = newSessions();
  const { id } = await sessions.create();

  await turn(sessions, id, { text: 'Rename the plan', openFile: 'notes.md' });

  const [user, reply, ...rest] = sessions.get(id)!.uiMessages;
  expect(rest).toEqual([]);
  expect(user).toEqual({ id: expect.any(String), role: 'user', parts: [{ type: 'text', text: 'Rename the plan' }] });
  expect(reply.role).toBe('assistant');
  expect(partsOf(reply, 'text')).toMatchObject([{ text: 'Done.' }]);
  expect(partsOf(reply, 'data-session')).toMatchObject([{ data: { aborted: false, edited: { 'notes.md': '# Vegetable Plan\n' } } }]);
});

test('a stopped turn records the request and a reply whose session part says it was stopped', async () => {
  useModel(scriptedModel([editHeading], 'Done.'));
  const sessions = newSessions();
  const { id } = await sessions.create();

  await turn(sessions, id, 'Rename the plan', (chunk) => {
    if (chunk.type === 'tool-output-available') sessions.cancel(id);
  });

  const [user, reply, ...rest] = sessions.get(id)!.uiMessages;
  expect(rest).toEqual([]);
  expect(user.parts).toEqual([{ type: 'text', text: 'Rename the plan' }]);
  expect(reply.role).toBe('assistant');
  expect(partsOf(reply, 'data-session')).toMatchObject([{ data: { aborted: true, edited: {} } }]);
});

// The error the chat showed is not a part, so the reply holds only what the model produced before it failed.
test('a failed turn records the request and the reply as far as it got', async () => {
  useModel(scriptedModel());
  const sessions = newSessions();
  const { id } = await sessions.create();

  await turn(sessions, id, 'Hello');

  const [user, reply, ...rest] = sessions.get(id)!.uiMessages;
  expect(rest).toEqual([]);
  expect(user.parts).toEqual([{ type: 'text', text: 'Hello' }]);
  expect(reply).toMatchObject({ id: expect.any(String), role: 'assistant', parts: [] });
});

test('the next turn sends the model neither a stopped turn nor a failed one', async () => {
  const sessions = newSessions();
  const { id } = await sessions.create();
  useModel(scriptedModel([editHeading], 'Done.'));
  await turn(sessions, id, 'Rename the plan', (chunk) => {
    if (chunk.type === 'tool-output-available') sessions.cancel(id);
  });
  useModel(scriptedModel());
  await turn(sessions, id, 'Hello');

  const model = scriptedModel('Hi.');
  useModel(model);
  await turn(sessions, id, 'Are you there?');

  const prompt = model.doStreamCalls[0].prompt.filter((m) => m.role !== 'system');
  expect(prompt.map((m) => [m.role, (m.content as { text: string }[])[0].text])).toEqual([['user', 'Are you there?']]);
});

test('as soon as a turn has been read to the end, the next turn on the session starts', async () => {
  const model = scriptedModel('First.', 'Second.');
  useModel(model);
  const sessions = newSessions();
  const { id } = await sessions.create();

  await turn(sessions, id, 'One');
  await turn(sessions, id, 'Two');

  const prompt = model.doStreamCalls[1].prompt.filter((m) => m.role !== 'system');
  expect(prompt.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
});

test('a second turn while one is running is refused at once', async () => {
  useModel(scriptedModel('First.'));
  const sessions = newSessions();
  const { id } = await sessions.create();

  const first = turn(sessions, id, 'One');
  expect(() => sessions.chat(id, { text: 'Two' })).toThrow(`session ${id} already has a turn in progress`);
  await first;
});

test("the reply's id in the page's stream is the id it is recorded under", async () => {
  useModel(scriptedModel('Done.'));
  const sessions = newSessions();
  const { id } = await sessions.create();

  const chunks = await turn(sessions, id, 'Hello');

  const start = chunks.find((c) => c.type === 'start');
  expect(start?.messageId).toBe(sessions.get(id)!.uiMessages[1].id);
});

test('a turn whose page went away still records its reply and edits', async () => {
  useModel(scriptedModel([editHeading], 'Done.'));
  const sessions = newSessions();
  const { id } = await sessions.create();
  const finished = new Promise((resolve) => events.subscribe((event) => event.type === 'turn-finished' && resolve(event)));

  const reader = sessions.chat(id, { text: 'Rename the plan' }).getReader();
  await reader.read();
  await reader.cancel();
  await finished;

  const reply = sessions.get(id)!.uiMessages[1];
  expect(partsOf(reply, 'data-session')).toMatchObject([{ data: { aborted: false, edited: { 'notes.md': '# Vegetable Plan\n' } } }]);
});

// Building the turn's model fails before the turn's own error handling starts.
const failBeforeStart = () =>
  mock.module('@ai-sdk/anthropic', () => ({
    anthropic: Object.assign(() => { throw new Error('no model today'); }, { tools: anthropic.tools }),
  }));

test('a turn that fails before it starts records a stopped reply and leaves the session free for the next turn', async () => {
  failBeforeStart();
  const sessions = newSessions();
  const { id } = await sessions.create();

  await turn(sessions, id, 'Hello');

  expect(sessions.get(id)!.uiMessages[1]).toMatchObject({ role: 'assistant', parts: [{ type: 'data-session', data: { aborted: true, edited: {} } }] });
  useModel(scriptedModel('Hi.'));
  await turn(sessions, id, 'Hello again');
  expect(partsOf(sessions.get(id)!.uiMessages[3], 'text')).toMatchObject([{ text: 'Hi.' }]);
});

test('turn-finished fires once per turn, after the reply is recorded, however the turn ended', async () => {
  const sessions = newSessions();
  const { id } = await sessions.create();
  const seen: { aborted: boolean; recorded: number }[] = [];
  events.subscribe((event) => {
    if (event.type === 'turn-finished') seen.push({ aborted: event.aborted, recorded: sessions.get(id)!.uiMessages.length });
  });

  useModel(scriptedModel('Done.'));
  await turn(sessions, id, 'Completed');
  useModel(scriptedModel([editHeading], 'Done.'));
  await turn(sessions, id, 'Stopped', (chunk) => {
    if (chunk.type === 'tool-output-available') sessions.cancel(id);
  });
  useModel(scriptedModel());
  await turn(sessions, id, 'Failed');
  failBeforeStart();
  await turn(sessions, id, 'Failed before starting');

  expect(seen).toEqual([
    { aborted: false, recorded: 2 },
    { aborted: true, recorded: 4 },
    { aborted: false, recorded: 6 },
    { aborted: false, recorded: 8 },
  ]);
});

const stored = async () => JSON.parse(await Bun.file(stateFile(workspace, 'session.json')).text());

test('a new session is recorded on disk with empty histories before create resolves', async () => {
  const sessions = newSessions();
  const { id } = await sessions.create();
  expect(await stored()).toEqual({ id, messages: [], uiMessages: [] });
});

const turnFinished = () => new Promise<void>((resolve) => {
  const stop = events.subscribe((event) => event.type === 'turn-finished' && (stop(), resolve()));
});

test('after a restart, the current session comes back with both histories and the model still sees the first turn', async () => {
  useModel(scriptedModel([editHeading], 'Done.'));
  const before = newSessions();
  const { id } = await before.create();
  const finished = turnFinished();
  await turn(before, id, { text: 'Rename the plan', openFile: 'notes.md' });
  await finished;

  const after = newSessions();
  await after.load();

  const session = after.current();
  expect(session.id).toBe(id);
  expect(session.messages).toEqual(JSON.parse(JSON.stringify(before.get(id)!.messages)));
  expect(session.uiMessages).toEqual(JSON.parse(JSON.stringify(before.get(id)!.uiMessages)));
  const model = scriptedModel('Still here.');
  useModel(model);
  await turn(after, id, 'What did you do?');
  const prompt = model.doStreamCalls[0].prompt.filter((m) => m.role !== 'system');
  expect(prompt.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user']);
});

test('a turn the server stopped in the middle of loads as stopped', async () => {
  const request: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Rename the plan' }] };
  await writeJson(stateFile(workspace, 'session.json'), { id: 's1', messages: [], uiMessages: [request] });

  const sessions = newSessions();
  await sessions.load();

  const stopped: UIMessage = { id: expect.any(String), role: 'assistant', parts: [{ type: 'data-session', data: { aborted: true, edited: {} } }] };
  expect(sessions.current().uiMessages).toEqual([request, stopped]);
  expect((await stored()).uiMessages).toEqual([request, stopped]);
});

test('a turn that finishes after Clear Chat does not bring the cleared chat back', async () => {
  useModel(scriptedModel('Done.'));
  const sessions = newSessions();
  const a = await sessions.create();
  const finished = turnFinished();
  const held = sessions.chat(a.id, { text: 'Hello' });
  const b = await sessions.create();
  for await (const _ of held);
  await finished;

  const after = newSessions();
  await after.load();
  expect(after.current()).toEqual({ id: b.id, messages: [], uiMessages: [] });
});

test('a fresh workspace loads a new session and stores nothing', async () => {
  const sessions = newSessions();
  await sessions.load();
  expect(sessions.current()).toEqual({ id: expect.any(String), messages: [], uiMessages: [] });
  expect(await Bun.file(stateFile(workspace, 'session.json')).exists()).toBe(false);
});

test('an unreadable record loads a new session', async () => {
  await writeJson(stateFile(workspace, 'session.json'), { id: 42, messages: [] });
  const sessions = newSessions();
  await sessions.load();
  expect(sessions.current()).toEqual({ id: expect.any(String), messages: [], uiMessages: [] });
});

test('Clear Chat replaces the stored session with a new one with empty histories', async () => {
  useModel(scriptedModel('Done.'));
  const sessions = newSessions();
  const first = await sessions.create();
  await turn(sessions, first.id, 'Hello');

  const res = await sessionRoutes(sessions).request('/api/sessions', { method: 'POST' });

  const { id } = await res.json();
  expect(res.status).toBe(201);
  expect(id).not.toBe(first.id);
  expect(await stored()).toEqual({ id, messages: [], uiMessages: [] });
});

test('a turn through the claude program that fails before any text shows why, and leaves the conversation as it was', async () => {
  const logged = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const sessions = newSessions({ claude: 'cli' });
    const { id } = await sessions.create();
    const chunks = await turn(sessions, id, 'fail');
    expect(chunks.filter((c) => c.type === 'error').map((c) => c.errorText)).toEqual(['claude failed: The model is not available.']);
    expect(sessions.get(id)!.messages).toEqual([]);
  } finally {
    logged.mockRestore();
  }
});

test('a turn through the claude program edits the post for the editor, shows the edit as a tool row, and saves nothing', async () => {
  const sessions = newSessions({ claude: 'cli' });
  const { id } = await sessions.create();

  const chunks = await turn(sessions, id, `call Edit ${JSON.stringify(editHeading.input)}`);

  expect(chunks.filter((c) => c.type === 'tool-input-available').map((c) => c.toolName)).toEqual(['Edit']);
  expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({ aborted: false, edited: { 'notes.md': '# Vegetable Plan\n' } });
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Garden Plan\n');
  expect(sessions.get(id)!.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
});
