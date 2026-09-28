import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { LoadAPIKeyError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatRequest } from '../shared/wire';
import { MISSING_API_KEY_HELP } from './agent';
import { Approvals } from './approvals';
import { EventBus } from './events';
import { Sessions, type SessionsOptions } from './sessions';
import { scriptedModel, useModel } from './test-model';

let workspace: string;
let events: EventBus;
let approvals: Approvals;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-sessions-'));
  await writeFile(join(workspace, 'notes.md'), '# Garden Plan\n');
  events = new EventBus();
  approvals = new Approvals(events, 60_000);
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

const newSessions = (options: Partial<SessionsOptions> = {}) => new Sessions({ workspace, ...options }, events, approvals);

test('a second turn sends the conversation so far', async () => {
  const model = scriptedModel('Garden Plan', 'You asked about Garden Plan.');
  useModel(model);
  const sessions = newSessions();
  const { id } = sessions.create();

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
  const { id } = sessions.create();

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
  const { id } = sessions.create();

  await turn(sessions, id, 'Fix the spelling');

  const [user] = model.doStreamCalls[0].prompt.filter((m) => m.role !== 'system');
  expect(user.content).toEqual([{ type: 'text', text: 'Fix the spelling' }]);
});

const editHeading = { tool: 'Edit', input: { file_path: 'notes.md', old_string: 'Garden', new_string: 'Vegetable' } };

// Runs a turn whose model asks to edit notes.md, answering its approval request with `allow`.
async function turnWithEdit(allow: boolean) {
  useModel(scriptedModel([editHeading], 'Done.'));
  const sessions = newSessions();
  const { id } = sessions.create();
  const requested: string[] = [];
  const chunks = await turn(sessions, id, 'Rename the plan', (chunk) => {
    if (chunk.type !== 'data-approval') return;
    requested.push(chunk.data.title);
    approvals.resolve(chunk.data.approvalId, allow);
  });
  return {
    requested,
    edited: chunks.find((c) => c.type === 'data-session')?.data.edited,
    disk: await Bun.file(join(workspace, 'notes.md')).text(),
  };
}

test('an edit the user allows is reported for the editor, and the file on disk is unchanged', async () => {
  expect(await turnWithEdit(true)).toEqual({
    requested: ['Allow Edit?'],
    edited: { 'notes.md': '# Vegetable Plan\n' },
    disk: '# Garden Plan\n',
  });
});

test('an edit the user denies is not reported', async () => {
  expect(await turnWithEdit(false)).toEqual({ requested: ['Allow Edit?'], edited: {}, disk: '# Garden Plan\n' });
});

test('a finished turn sends the final text of each post it edited, starting from what the browser sent', async () => {
  const typed = { tool: 'Edit', input: { file_path: 'notes.md', old_string: 'typed', new_string: 'kept' } };
  useModel(scriptedModel([typed], 'Done.'));
  const sessions = newSessions();
  const { id } = sessions.create();

  const chunks = await turn(sessions, id, { text: 'Keep it', documents: { 'notes.md': '# Garden Plan, typed\n' } }, (chunk) => {
    if (chunk.type === 'data-approval') approvals.resolve(chunk.data.approvalId, true);
  });

  expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({ aborted: false, edited: { 'notes.md': '# Garden Plan, kept\n' } });
});

test('a stopped turn sends no edits', async () => {
  useModel(scriptedModel([editHeading], 'Done.'));
  const sessions = newSessions();
  const { id } = sessions.create();

  const chunks = await turn(sessions, id, 'Rename the plan', (chunk) => {
    if (chunk.type === 'data-approval') sessions.cancel(id);
  });

  expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({ aborted: true, edited: {} });
});

test('a turn stops after the step limit', async () => {
  const readNotes = [{ tool: 'Read', input: { file_path: 'notes.md' } }];
  const model = scriptedModel(readNotes, readNotes, readNotes, 'Done.');
  useModel(model);
  const sessions = newSessions({ maxSteps: 2 });
  const { id } = sessions.create();
  const chunks = await turn(sessions, id, 'Keep reading');
  expect(model.doStreamCalls.length).toBe(2);
  expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({ aborted: false, edited: {} });
});

test('a turn that fails shows the model error', async () => {
  useModel(scriptedModel());
  const sessions = newSessions();
  const { id } = sessions.create();
  const chunks = await turn(sessions, id, 'Hello');
  expect(chunks.filter((c) => c.type === 'error').map((c) => c.errorText)).toContain('the script has no reply for model call 1');
});

test('a turn with no API key explains how to set one, without a stack trace', async () => {
  const missingKey = new LoadAPIKeyError({ message: 'Anthropic API key is missing.' });
  useModel(new MockLanguageModelV4({ doStream: async () => { throw missingKey; } }));
  const logged = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const sessions = newSessions();
    const { id } = sessions.create();
    const chunks = await turn(sessions, id, 'Hello');
    expect(chunks.filter((c) => c.type === 'error').map((c) => c.errorText)).toEqual([MISSING_API_KEY_HELP]);
    expect(logged.mock.calls).toEqual([[MISSING_API_KEY_HELP]]);
  } finally {
    logged.mockRestore();
  }
});
