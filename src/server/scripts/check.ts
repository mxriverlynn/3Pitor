// End-to-end check for 3pitor: resets the workspace, starts the server, and drives
// every scenario through the real HTTP, SSE and WebSocket API.
import { join, resolve } from 'node:path';
import type { ChatRequest } from '../../shared/wire';
import { SRC } from '../paths';
import { dataDir, resetWorkspace } from '../workspace';

let BASE = ''; // set once the server reports the port it picked
const WORKSPACE = dataDir('check-workspace'); // separate from the one `bun run server` uses
const only = process.argv.slice(2); // optional: run scenarios whose name contains any of these

type Chunk = { type: string; delta?: string; data?: any; toolName?: string; input?: any; errorText?: string };
type Turn = { text: string; chunks: Chunk[]; ms: number };

const results: { name: string; ok: boolean; detail: string; ms: number }[] = [];
const events: any[] = [];

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// Sends one chat turn and parses the AI SDK UI message stream (SSE) as it arrives. A request can carry
// what the UI would send: the file open in the editor, and the documents the editor holds.
async function chat(sessionId: string, request: string | ChatRequest, onChunk?: (chunk: Chunk) => void): Promise<Turn> {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(typeof request === 'string' ? { text: request } : request),
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status} ${await res.text()}`);
  const chunks: Chunk[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of res.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let split: number;
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        const chunk = JSON.parse(line.slice(6)) as Chunk;
        chunks.push(chunk);
        onChunk?.(chunk);
      }
    }
  }
  const text_ = chunks.filter((c) => c.type === 'text-delta').map((c) => c.delta).join('');
  return { text: text_, chunks, ms: Date.now() - started };
}

const dataOf = (turn: Turn, type: string) => turn.chunks.filter((c) => c.type === type).map((c) => c.data);
const errorsOf = (turn: Turn) => turn.chunks.filter((c) => c.type === 'error').map((c) => c.errorText);

async function scenario(name: string, fn: () => Promise<string>) {
  if (only.length && !only.some((o) => name.includes(o))) return;
  const started = Date.now();
  process.stdout.write(`… ${name}\n`);
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, ms: Date.now() - started });
  } catch (error) {
    results.push({ name, ok: false, detail: (error as Error).message, ms: Date.now() - started });
  }
  const r = results.at(-1)!;
  process.stdout.write(`${r.ok ? '✔' : '✘'} ${name} (${(r.ms / 1000).toFixed(1)}s): ${r.detail}\n`);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const readDoc = async (name: string) => Bun.file(resolve(WORKSPACE, name)).text();
const clip = (s: string, n = 120) => s.replace(/\s+/g, ' ').trim().slice(0, n);

// ---------------------------------------------------------------------------

await resetWorkspace(WORKSPACE);
// PORT=0 lets the server pick a free port, so several checks can run at once.
const server = Bun.spawn(['bun', 'run', join(SRC, 'server/server.ts')], {
  env: { ...process.env, PORT: '0', WORKSPACE, OPEN_BROWSER: '0' },
  stdout: 'pipe',
  stderr: 'inherit',
});

// Echo the server's output, and take its URL from the "listening on <url>" line.
async function serverUrl(stdout: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`server exited before reporting its URL:\n${seen}`);
    const text = decoder.decode(value, { stream: true });
    process.stdout.write(text);
    seen += text;
    const match = seen.match(/listening on (http:\/\/\S+)/);
    if (!match) continue;
    (async () => {
      for (;;) {
        const next = await reader.read();
        if (next.done) return;
        process.stdout.write(decoder.decode(next.value, { stream: true }));
      }
    })();
    return match[1];
  }
}

try {
  // Fail fast rather than hang if the server never prints its "listening on <url>" line.
  BASE = await Promise.race([
    serverUrl(server.stdout),
    Bun.sleep(15_000).then(() => {
      throw new Error('server did not report its URL within 15s; check its "listening on <url>" log line');
    }),
  ]);
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await Bun.sleep(100);
  }

  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/events`);
  await new Promise((ok, fail) => ((ws.onopen = ok), (ws.onerror = fail)));
  ws.onmessage = (msg) => events.push(JSON.parse(String(msg.data)));

  const { json: session } = await api('POST', '/api/sessions');

  await scenario('documents: save and load over REST', async () => {
    await api('PUT', '/api/documents/scratch.md', { content: '# Scratch\n' });
    const { json } = await api('GET', '/api/documents/scratch.md');
    expect(json.content === '# Scratch\n', `loaded ${JSON.stringify(json)}`);
    return 'round-tripped scratch.md';
  });

  await scenario('chat: streams a reply that reads a document', async () => {
    const turn = await chat(session.id, 'Read notes.md and reply with only its H1 heading text, nothing else.');
    expect(!errorsOf(turn).length, `stream errors: ${errorsOf(turn)}`);
    expect(/garden plan/i.test(turn.text), `reply was "${clip(turn.text)}"`);
    const deltas = turn.chunks.filter((c) => c.type === 'text-delta').length;
    return `"${clip(turn.text)}" in ${turn.ms}ms, ${deltas} text deltas`;
  });

  await scenario('config: app and workspace skills and both agent kinds are loaded', async () => {
    const { json: config } = await api('GET', '/api/workspace-config');
    expect(config.skills.includes('collaborative-draft-editing'), `skills: ${config.skills}`);
    expect(config.skills.includes('doc-stats'), `skills: ${config.skills}`);
    expect(config.agents.includes('proofreader'), `agents: ${config.agents}`);
    expect(config.agents.includes('title-writer'), `agents: ${config.agents}`);
    return `skills=[${config.skills}] agents=[${config.agents}]`;
  });

  await scenario('chat: second turn remembers the first', async () => {
    const turn = await chat(session.id, 'What heading did you just tell me? Reply with only that heading.');
    expect(/garden plan/i.test(turn.text), `reply was "${clip(turn.text)}"`);
    return `"${clip(turn.text)}", remembered`;
  });

  await scenario('chat: acts on the open file', async () => {
    const { json: fresh } = await api('POST', '/api/sessions');
    const turn = await chat(fresh.id, { text: 'Reply with only the H1 heading of this file, nothing else.', openFile: 'notes.md' });
    expect(!errorsOf(turn).length, `stream errors: ${errorsOf(turn)}`);
    expect(/garden plan/i.test(turn.text), `reply was "${clip(turn.text)}"`);
    return `"${clip(turn.text)}" without naming the file`;
  });

  await scenario('edit: lands in edited, not on disk', async () => {
    const before = await readDoc('notes.md');
    const seen: string[] = [];
    const turn = await chat(
      session.id,
      { text: 'Append a new final line to notes.md that says exactly: 3pitor was here.', documents: { 'notes.md': before } },
      (chunk) => {
        if (chunk.type === 'tool-input-available' && chunk.toolName) seen.push(chunk.toolName);
      },
    );
    const edited = dataOf(turn, 'data-session')[0]?.edited ?? {};
    expect(edited['notes.md']?.includes('3pitor was here.'), `notes.md not in edited; reply "${clip(turn.text)}"`);
    expect((await readDoc('notes.md')) === before, 'the file on disk changed');
    return `tools: ${seen.join(', ') || 'none'}; no approval asked; edited notes.md; disk unchanged`;
  });

  await scenario('write: a new post lands in edited, not on disk', async () => {
    const turn = await chat(session.id, 'Create a new post named summary.md holding a one-sentence summary of notes.md.');
    const edited = dataOf(turn, 'data-session')[0]?.edited ?? {};
    expect(edited['summary.md']?.trim(), `summary.md not in edited; reply "${clip(turn.text)}"`);
    expect(!(await Bun.file(resolve(WORKSPACE, 'summary.md')).exists()), 'summary.md was written to disk');
    return `summary.md: "${clip(edited['summary.md'], 80)}"; no file on disk`;
  });

  await scenario('chat: refuses documents that are not a map of names to markdown', async () => {
    const res = await fetch(`${BASE}/api/sessions/${session.id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hi', documents: ['notes.md'] }),
    });
    expect(res.status === 400, `status ${res.status}`);
    return `status ${res.status}: ${(await res.json()).error}`;
  });

  await scenario('skill: project skill runs', async () => {
    const turn = await chat(session.id, 'Use the doc-stats skill on notes.md.');
    expect(/DOC-STATS:/.test(turn.text), `reply was "${clip(turn.text)}"`);
    return clip(turn.text.match(/DOC-STATS:.*/)![0]);
  });

  await scenario('skill: collaborative-draft-editing reads its files from the app and highlights its first stop', async () => {
    const { json: fresh } = await api('POST', '/api/sessions');
    const draft =
      '# Why I Test My Soil\n\nMost gardeners never test their soil, and honestly it is kind of amazing how much that matters.\n\n' +
      '## The test\n\nA home kit costs a few dollars. As I said earlier, it tells you the pH and the nutrients.\n\n' +
      '## What changed\n\nMy tomatoes doubled the year I started testing.\n';
    const calls: { tool: string; path: string }[] = [];
    const turn = await chat(
      fresh.id,
      { text: '/collaborative-draft-editing soil-draft.md', openFile: 'soil-draft.md', documents: { 'soil-draft.md': draft } },
      (chunk) => {
        if (chunk.type === 'tool-input-available' && chunk.toolName) calls.push({ tool: chunk.toolName, path: String(chunk.input?.file_path ?? chunk.input?.pattern ?? '') });
      },
    );
    expect(!errorsOf(turn).length, `stream errors: ${errorsOf(turn)}`);
    const summary = calls.map((c) => `${c.tool}(${c.path})`).join(', ');
    expect(calls.some((c) => c.tool === 'Read' && c.path.startsWith('3pitor://skills/collaborative-draft-editing/')), `no 3pitor:// Read: ${summary}`);
    expect(!calls.some((c) => /\.han\/|reflow|\.git\//.test(c.path)), `reached for a Claude Code path: ${summary}`);
    const highlights = dataOf(turn, 'data-session')[0]?.highlights;
    expect(highlights?.file === 'soil-draft.md' && highlights.passages.length, `no highlights of the draft; tools ${summary}; reply "${clip(turn.text)}"`);
    expect(/\*\*Q\d+\*\*/.test(turn.text), `no bold-labeled question; reply "${clip(turn.text, 300)}"`);
    const unasked = highlights.passages.filter((p: { question?: string }) => !p.question?.trim());
    expect(!unasked.length, `passages without a question: ${JSON.stringify(unasked)}`);
    return `tools: ${summary}; highlighted ${highlights.passages.map((p: { label?: string }) => p.label).join(', ')}`;
  });

  await scenario('agent: filesystem subagent (.claude/agents) runs', async () => {
    const turn = await chat(session.id, 'Have the proofreader agent proofread notes.md, then relay its report verbatim.');
    const tasks = dataOf(turn, 'data-task');
    const usedAgent = tasks.some((t) => t.subagentType === 'proofreader');
    const toolCalls = turn.chunks.filter((c) => c.type === 'tool-input-available').map((c) => c.toolName);
    expect(usedAgent && /PROOFREADER REPORT/.test(turn.text), `tasks ${JSON.stringify(tasks)}; tools ${toolCalls}; reply "${clip(turn.text)}"`);
    // The subagent must finish inside this turn, not leak its result into the next one.
    expect(tasks.some((t) => t.subtype === 'task_notification'), `subagent did not finish within the turn; reply "${clip(turn.text)}"`);
    return `task events: ${tasks.map((t) => `${t.subtype}:${t.subagentType ?? '?'}`).join(', ') || 'none'}; tools: ${toolCalls}; mentions tomatoes: ${/tomatoes/i.test(turn.text)}`;
  });

  await scenario('agent: code-defined subagent runs', async () => {
    const turn = await chat(session.id, 'Ask the title-writer agent for a title suggestion for notes.md and relay its answer.');
    const tasks = dataOf(turn, 'data-task');
    const usedAgent = tasks.some((t) => t.subagentType === 'title-writer');
    expect(usedAgent && /TITLE SUGGESTION/.test(turn.text), `tasks ${JSON.stringify(tasks)}; reply "${clip(turn.text)}"`);
    // The subagent must finish inside this turn, not leak its result into the next one.
    expect(tasks.some((t) => t.subtype === 'task_notification'), `subagent did not finish within the turn; reply "${clip(turn.text)}"`);
    return `task events: ${tasks.map((t) => `${t.subtype}:${t.subagentType ?? '?'}`).join(', ') || 'none'}; reply "${clip(turn.text, 80)}"`;
  });

  await scenario('cancel: a running turn stops and the session keeps working', async () => {
    const { json: s } = await api('POST', '/api/sessions');
    let cancelledAt = 0;
    let cancelledOn = '';
    const turn = await chat(s.id, 'Count from 1 to 400, one number per line, with no other text.', (chunk) => {
      // The model may answer in text or reach for a tool; cancel on either.
      if ((chunk.type === 'text-delta' || chunk.type === 'tool-input-start') && !cancelledAt) {
        cancelledOn = chunk.type;
        cancelledAt = Date.now();
        api('POST', `/api/sessions/${s.id}/cancel`);
      }
    });
    expect(cancelledAt, 'never saw text or a tool call to cancel on');
    const stopMs = Date.now() - cancelledAt;
    const info = dataOf(turn, 'data-session')[0];
    expect(!/\b400\b/.test(turn.text), 'turn ran to completion');
    const next = await chat(s.id, 'Reply with the single word READY.');
    expect(/READY/i.test(next.text), `follow-up reply "${clip(next.text)}"`);
    return `cancelled on ${cancelledOn}, stopped ${stopMs}ms later; aborted=${info?.aborted}; errors=${errorsOf(turn).length}; follow-up ok`;
  });

  ws.close();
} finally {
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
