// Debug: does a background subagent outlive its chat turn, and does that break later turns or cancelling?
import { cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentHost } from './core/agent-host';

const workspace = resolve('.data/debug-workspace');
await rm(workspace, { recursive: true, force: true });
await cp(resolve('fixtures/workspace'), workspace, { recursive: true });

const host = new AgentHost({ workspace });
const t0 = Date.now();
const log = (...args: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args);
host.subscribe((e) => {
  if (e.type === 'task') log('event task', e.subtype, e.subagentType ?? '');
  if (e.type === 'turn-finished') log('event turn-finished aborted=', e.aborted);
});

async function turn(sessionId: string, text: string, cancelOnFirstText = false) {
  log('>>>', text);
  const reader = host.chat(sessionId, text).getReader();
  let reply = '';
  let cancelled = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === 'text-delta') reply += value.delta;
    if (cancelOnFirstText && (value.type === 'text-delta' || value.type === 'data-approval') && !cancelled) {
      cancelled = true;
      log('cancel on', value.type, '->', host.cancel(sessionId));
    }
    if (value.type === 'tool-input-available') log('tool', value.toolName);
    if (value.type === 'error') log('stream error', value.errorText);
  }
  log('<<<', JSON.stringify(reply.slice(0, 160)));
}

const a = host.createSession().id;
await turn(a, 'Have the proofreader agent proofread notes.md, then relay its report verbatim.');
await turn(a, 'Ask the title-writer agent for a title suggestion for notes.md and relay its answer.');

const b = host.createSession().id;
const watchdog = setTimeout(() => {
  log('cancel turn still not finished after 30s');
  process.exit(1);
}, 30_000 + (Date.now() - t0));
await turn(b, 'Count from 1 to 400, one number per line, with no other text.', true);
clearTimeout(watchdog);
log('done');
process.exit(0);
