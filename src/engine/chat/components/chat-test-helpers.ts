// Helpers for tests that run chat turns and model calls, shared by the engine's chat tests and the server's MCP
// endpoint tests.
import type { UIMessageChunk } from 'ai';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatRequest } from '../../../shared/wire';
import { turnTexts } from '../tools/tools';
import { createLocalFileSystem, type FileSystem } from '../../../file-system/file-system';

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Up to two seconds for a condition that settles once a killed child is gone.
export async function eventually(check: () => boolean) {
  for (let i = 0; i < 40 && !check(); i++) await Bun.sleep(50);
  return check();
}

// Reads the stream up to the fake claude's "pid=<n>" text, and returns that pid with the reader, still open.
export async function untilPid(stream: ReadableStream<{ type: string; delta?: string }>) {
  const reader = stream.getReader();
  for (;;) {
    const { value } = await reader.read();
    const pid = value?.delta?.match(/^pid=(\d+)$/)?.[1];
    if (pid) return { pid: Number(pid), reader };
  }
}

// A call the way the AI SDK makes one, with a single user message.
export const userCall = (text: string, abortSignal?: AbortSignal) => ({
  prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }],
  abortSignal,
});

// A workspace with notes.md on disk and a different, unsaved copy of it in the browser.
export async function withWorkspace(
  run: (workspace: string, turn: ReturnType<typeof turnTexts>, fileSystem: FileSystem) => Promise<void>,
) {
  const workspace = await mkdtemp(join(tmpdir(), '3pitor-claude-cli-'));
  try {
    await writeFile(join(workspace, 'notes.md'), '# Notes\n');
    await run(workspace, turnTexts({ 'notes.md': '# Notes typed but not saved\n' }), createLocalFileSystem(workspace));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export type Chunk = { type: string; [key: string]: any };

// Runs one chat turn and returns every UI stream chunk it produced, calling onChunk as each arrives.
export async function turn(
  sessions: { chat(sessionId: string, request: ChatRequest): ReadableStream<UIMessageChunk> },
  sessionId: string,
  request: string | ChatRequest,
  onChunk?: (chunk: Chunk) => void,
) {
  const chunks: Chunk[] = [];
  const body = typeof request === 'string' ? { text: request } : request;
  for await (const chunk of sessions.chat(sessionId, body) as unknown as AsyncIterable<Chunk>) {
    chunks.push(chunk);
    onChunk?.(chunk);
  }
  return chunks;
}

// The text of a turn's reply, which the fake claude uses to report what it saw.
export const replyText = (chunks: Chunk[]) => chunks.filter((c) => c.type === 'text-delta').map((c) => c.delta).join('');

// An Edit that renames notes.md's "# Garden Plan" heading.
export const editHeading = { tool: 'Edit', input: { file_path: 'notes.md', old_string: 'Garden', new_string: 'Vegetable' } };
