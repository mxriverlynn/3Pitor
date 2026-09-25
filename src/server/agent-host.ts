// Wires the transport-agnostic feature objects together. Nothing below this file knows about
// HTTP or WebSockets: the server maps these objects onto routes and sockets.
import { Approvals } from './approvals';
import { EventBus } from './events';
import { Jobs } from './jobs';
import { Sessions } from './sessions';

export interface AgentHostOptions {
  workspace: string;
  model?: string;
  approvalTimeoutMs?: number;
  // Model steps allowed in one chat turn. Nothing sets it yet; a future config setting will.
  maxSteps?: number;
}

export function createAgentHost(options: AgentHostOptions) {
  const events = new EventBus();
  const approvals = new Approvals(events, options.approvalTimeoutMs ?? 5 * 60_000);
  const sessions = new Sessions(options, events, approvals);
  const jobs = new Jobs(options, events);
  return { events, approvals, sessions, jobs };
}

export type AgentHost = ReturnType<typeof createAgentHost>;
