import { expect, test } from 'bun:test';
import type { UIMessageStreamWriter } from 'ai';
import type { HostEvent } from '../shared/wire';
import { Approvals } from './approvals';
import { EventBus } from './events';

const writer = { write: () => {} } as unknown as UIMessageStreamWriter;

// Starts one approval request and returns its id along with the pending answer.
function ask(approvals: Approvals, bus: EventBus, signal = new AbortController().signal) {
  let approvalId = '';
  const off = bus.subscribe((e: HostEvent) => {
    if (e.type === 'approval-request') approvalId = e.approvalId;
  });
  const answer = approvals.request('s-1', 'Edit', { file_path: 'notes.md' }, signal, writer);
  off();
  return { approvalId, answer };
}

test('an allowed request resolves true, and a denied one false', async () => {
  const bus = new EventBus();
  const approvals = new Approvals(bus, 60_000);
  const allowed = ask(approvals, bus);
  approvals.resolve(allowed.approvalId, true);
  expect(await allowed.answer).toBe(true);
  const denied = ask(approvals, bus);
  approvals.resolve(denied.approvalId, false);
  expect(await denied.answer).toBe(false);
});

test('a request whose turn is stopped resolves false', async () => {
  const bus = new EventBus();
  const abort = new AbortController();
  const { answer } = ask(new Approvals(bus, 60_000), bus, abort.signal);
  abort.abort();
  expect(await answer).toBe(false);
});
