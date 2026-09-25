// End-to-end check for 3pitor: resets the workspace, starts the server, and drives
// every scenario through the real HTTP, SSE and WebSocket API.
import { join, resolve } from 'node:path';
import { SRC, dataDir, resetWorkspace } from '../workspace';

let BASE = ''; // set once the server reports the port it picked
const WORKSPACE = dataDir('check-workspace'); // separate from the one `bun run server` uses
const only = process.argv.slice(2); // optional: run scenarios whose name contains any of these

type Chunk = { type: string; delta?: string; data?: any; toolName?: string; errorText?: string };
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

// Sends one chat turn and parses the AI SDK UI message stream (SSE) as it arrives.
async function chat(sessionId: string, text: string, onChunk?: (chunk: Chunk) => void): Promise<Turn> {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
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
  let claudeSessionId: string | undefined;

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
    claudeSessionId = dataOf(turn, 'data-session')[0]?.claudeSessionId;
    expect(claudeSessionId, 'no Claude session id reported');
    const deltas = turn.chunks.filter((c) => c.type === 'text-delta').length;
    return `"${clip(turn.text)}" in ${turn.ms}ms, ${deltas} text deltas, session ${claudeSessionId.slice(0, 8)}`;
  });

  await scenario('config: workspace skill and both agent kinds are loaded', async () => {
    const init = events.find((e) => e.type === 'init' && e.sessionId === session.id);
    expect(init, 'no init event seen');
    expect(init.skills.includes('doc-stats'), `skills: ${init.skills}`);
    expect(init.agents.includes('proofreader'), `agents: ${init.agents}`);
    expect(init.agents.includes('title-writer'), `agents: ${init.agents}`);
    expect(init.slashCommands.includes('doc-stats'), `slash commands: ${init.slashCommands}`);
    return `skills=[${init.skills}] agents=[${init.agents}]`;
  });

  await scenario('chat: second turn resumes the same session', async () => {
    const turn = await chat(session.id, 'What heading did you just tell me? Reply with only that heading.');
    expect(/garden plan/i.test(turn.text), `reply was "${clip(turn.text)}"`);
    const again = dataOf(turn, 'data-session')[0]?.claudeSessionId;
    expect(again === claudeSessionId, `session changed: ${claudeSessionId} -> ${again}`);
    return `"${clip(turn.text)}", same session`;
  });

  await scenario('approval: edit is requested, approved over REST, and applied', async () => {
    const seen: string[] = [];
    const turn = await chat(
      session.id,
      'Append a new final line to notes.md that says exactly: 3pitor was here.',
      (chunk) => {
        if (chunk.type !== 'data-approval') return;
        seen.push(chunk.data.toolName);
        api('POST', `/api/approvals/${chunk.data.approvalId}`, { allow: true });
      },
    );
    expect(seen.length, `no approval requested; reply "${clip(turn.text)}"`);
    const doc = await readDoc('notes.md');
    expect(doc.includes('3pitor was here.'), `file not changed:\n${doc}`);
    return `approved ${seen.join(', ')}; notes.md updated`;
  });

  await scenario('approval: edit is denied over the WebSocket and not applied', async () => {
    const before = await readDoc('notes.md');
    const denied: string[] = [];
    const onEvent = (msg: MessageEvent) => {
      const event = JSON.parse(String(msg.data));
      if (event.type !== 'approval-request' || event.sessionId !== session.id) return;
      denied.push(event.toolName);
      ws.send(JSON.stringify({ type: 'approval-response', approvalId: event.approvalId, allow: false }));
    };
    ws.addEventListener('message', onEvent);
    const turn = await chat(
      session.id,
      'Replace the heading in notes.md with "# Vegetable Plan". If the edit is denied, stop and say DENIED.',
    );
    ws.removeEventListener('message', onEvent);
    expect(denied.length, `no approval requested; reply "${clip(turn.text)}"`);
    expect((await readDoc('notes.md')) === before, 'file changed despite denial');
    const resolved = events.filter((e) => e.type === 'approval-resolved' && e.allow === false).length;
    return `denied ${denied.join(', ')}; file unchanged; ${resolved} denial event(s); reply "${clip(turn.text, 60)}"`;
  });

  await scenario('skill: project skill runs', async () => {
    const turn = await chat(session.id, 'Use the doc-stats skill on notes.md.');
    expect(/DOC-STATS:/.test(turn.text), `reply was "${clip(turn.text)}"`);
    return clip(turn.text.match(/DOC-STATS:.*/)![0]);
  });

  await scenario('agent: filesystem subagent (.claude/agents) runs', async () => {
    const turn = await chat(session.id, 'Have the proofreader agent proofread notes.md, then relay its report verbatim.');
    const tasks = dataOf(turn, 'data-task');
    const usedAgent = tasks.some((t) => t.subagentType === 'proofreader');
    const toolCalls = turn.chunks.filter((c) => c.type === 'tool-input-available').map((c) => c.toolName);
    expect(usedAgent || /PROOFREADER REPORT/.test(turn.text), `tasks ${JSON.stringify(tasks)}; tools ${toolCalls}; reply "${clip(turn.text)}"`);
    // The subagent must finish inside this turn, not leak its result into the next one.
    expect(tasks.some((t) => t.subtype === 'task_notification'), `subagent did not finish within the turn; reply "${clip(turn.text)}"`);
    return `task events: ${tasks.map((t) => `${t.subtype}:${t.subagentType ?? '?'}`).join(', ') || 'none'}; tools: ${toolCalls}; mentions tomatoes: ${/tomatoes/i.test(turn.text)}`;
  });

  await scenario('agent: programmatic subagent (agents option) runs', async () => {
    const turn = await chat(session.id, 'Ask the title-writer agent for a title suggestion for notes.md and relay its answer.');
    const tasks = dataOf(turn, 'data-task');
    const usedAgent = tasks.some((t) => t.subagentType === 'title-writer');
    expect(usedAgent || /TITLE SUGGESTION/.test(turn.text), `tasks ${JSON.stringify(tasks)}; reply "${clip(turn.text)}"`);
    // The subagent must finish inside this turn, not leak its result into the next one.
    expect(tasks.some((t) => t.subtype === 'task_notification'), `subagent did not finish within the turn; reply "${clip(turn.text)}"`);
    return `task events: ${tasks.map((t) => `${t.subtype}:${t.subagentType ?? '?'}`).join(', ') || 'none'}; reply "${clip(turn.text, 80)}"`;
  });

  await scenario('cancel: a running turn stops and the session keeps working', async () => {
    const { json: s } = await api('POST', '/api/sessions');
    let cancelledAt = 0;
    let cancelledOn = '';
    const turn = await chat(s.id, 'Count from 1 to 400, one number per line, with no other text.', (chunk) => {
      // The model may answer in text or try to write a file (which waits on an approval); cancel on either.
      if ((chunk.type === 'text-delta' || chunk.type === 'data-approval') && !cancelledAt) {
        cancelledOn = chunk.type;
        cancelledAt = Date.now();
        api('POST', `/api/sessions/${s.id}/cancel`);
      }
    });
    expect(cancelledAt, 'never saw text or an approval to cancel on');
    const stopMs = Date.now() - cancelledAt;
    const info = dataOf(turn, 'data-session')[0];
    expect(!/\b400\b/.test(turn.text), 'turn ran to completion');
    const next = await chat(s.id, 'Reply with the single word READY.');
    expect(/READY/i.test(next.text), `follow-up reply "${clip(next.text)}"`);
    return `cancelled on ${cancelledOn}, stopped ${stopMs}ms later; aborted=${info?.aborted}; errors=${errorsOf(turn).length}; follow-up ok`;
  });

  await scenario('job: background run edits a file with no approvals', async () => {
    const { json: job } = await api('POST', '/api/jobs', {
      prompt: 'Create summary.md containing a one-sentence summary of notes.md.',
      maxTurns: 8,
    });
    let status = job;
    while (status.status === 'running') {
      await Bun.sleep(500);
      status = (await api('GET', `/api/jobs/${job.id}`)).json;
    }
    expect(status.status === 'succeeded', `job ${status.status}: ${status.error}`);
    const summary = await readDoc('summary.md').catch(() => '');
    expect(summary.trim(), 'summary.md missing');
    const statusEvents = events.filter((e) => e.type === 'job-status' && e.jobId === job.id).map((e) => e.status);
    return `summary.md: "${clip(summary, 80)}"; events: ${statusEvents.join(' -> ')}`;
  });

  await scenario('job: wall-clock timeout stops a long run', async () => {
    const { json: job } = await api('POST', '/api/jobs', {
      prompt: 'Write a 3000-word essay about soil science into essay.md.',
      timeoutMs: 4000,
    });
    let status = job;
    while (status.status === 'running') {
      await Bun.sleep(250);
      status = (await api('GET', `/api/jobs/${job.id}`)).json;
    }
    expect(status.status === 'timed-out', `job ended as ${status.status}`);
    return `ended as timed-out after ${status.finishedAt - status.startedAt}ms`;
  });

  ws.close();
} finally {
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
