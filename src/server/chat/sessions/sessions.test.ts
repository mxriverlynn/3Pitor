import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { LoadAPIKeyError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatRequest } from '../../../shared/wire';
import { MISSING_API_KEY_HELP } from '../agent/agent';
import { EventBus } from '../../events/events';
import { Sessions, type SessionsOptions } from './sessions';
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

const newSessions = (options: Partial<SessionsOptions> = {}) => new Sessions({ workspace, ...options }, events);

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

test('an edit needs no approval: the turn reports it for the editor, and the file on disk is unchanged', async () => {
  useModel(scriptedModel([editHeading], 'Done.'));
  const sessions = newSessions();
  const { id } = sessions.create();

  const chunks = await turn(sessions, id, 'Rename the plan');

  expect(chunks.filter((c) => c.type === 'data-approval')).toEqual([]);
  expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({ aborted: false, edited: { 'notes.md': '# Vegetable Plan\n' } });
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Garden Plan\n');
});

test('a finished turn sends the final text of each post it edited, starting from what the browser sent', async () => {
  const typed = { tool: 'Edit', input: { file_path: 'notes.md', old_string: 'typed', new_string: 'kept' } };
  useModel(scriptedModel([typed], 'Done.'));
  const sessions = newSessions();
  const { id } = sessions.create();

  const chunks = await turn(sessions, id, { text: 'Keep it', documents: { 'notes.md': '# Garden Plan, typed\n' } });

  expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({ aborted: false, edited: { 'notes.md': '# Garden Plan, kept\n' } });
});

test('a stopped turn sends no edits', async () => {
  useModel(scriptedModel([editHeading], 'Done.'));
  const sessions = newSessions();
  const { id } = sessions.create();

  const chunks = await turn(sessions, id, 'Rename the plan', (chunk) => {
    if (chunk.type === 'tool-output-available') sessions.cancel(id);
  });

  expect(chunks.find((c) => c.type === 'data-session')?.data).toEqual({ aborted: true, edited: {} });
});

test('a finished turn sends its last highlights for the editor; a stopped turn or one with no Highlight sends none', async () => {
  const highlight = { tool: 'Highlight', input: { file_path: 'notes.md', passages: [{ quote: 'Garden Plan', label: 'Q1' }] } };
  const sessions = newSessions();
  const { id } = sessions.create();
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
