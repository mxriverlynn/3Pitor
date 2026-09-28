// Wires the transport-agnostic feature objects together. Nothing below this file knows about
// HTTP or WebSockets: the server maps these objects onto routes and sockets.
import { EventBus } from './events';
import { Sessions } from './sessions';

export interface AgentHostOptions {
  workspace: string;
  model?: string;
  // Model steps allowed in one chat turn. Nothing sets it yet; a future config setting will.
  maxSteps?: number;
}

export function createAgentHost(options: AgentHostOptions) {
  const events = new EventBus();
  const sessions = new Sessions(options, events);
  return { events, sessions };
}

export type AgentHost = ReturnType<typeof createAgentHost>;
