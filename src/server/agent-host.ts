// Wires the transport-agnostic feature objects together. Nothing below this file knows about
// HTTP or WebSockets: the server maps these objects onto routes and sockets.
import { EventBus } from './events/events';
import { Sessions } from './chat/sessions/sessions';
import type { ClaudeMode } from '../shared/wire';
import type { ServeTools } from './chat/claude-cli/claude-cli';

export interface AgentHostOptions {
  workspace: string;
  model?: string;
  // How chat reaches Claude, decided once at startup.
  claude: ClaudeMode;
  // Model steps allowed in one chat turn. Nothing sets it yet; a future config setting will.
  maxSteps?: number;
  // Lends a call's tools to the claude program.
  serveTools: ServeTools;
}

export function createAgentHost(options: AgentHostOptions) {
  const events = new EventBus();
  const sessions = new Sessions(options, events);
  return { events, sessions };
}

export type AgentHost = ReturnType<typeof createAgentHost>;
