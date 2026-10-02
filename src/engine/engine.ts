// The engine: everything 3pitor does that is not HTTP or WebSockets. Server code reaches it only through this
// module; it knows nothing about requests, responses, status codes, SSE framing, or sockets. It wires the feature
// objects together over one workspace.
import type { UIMessage, UIMessageChunk } from 'ai';
import type { ChatRequest, ClaudeMode, CurrentSession, DocumentEntry, FolderCount, HostEvent, ViewState } from '../shared/wire';
import { claudeBackend } from './chat/claude-backend/claude-backend';
import type { ServeTools } from './chat/claude-cli/claude-cli';
import { Sessions } from './chat/sessions/sessions';
import { countContents, createEntry, deleteEntry, listEntries, moveEntry, readDocument, watchDocuments, writeDocument } from './documents/documents';
import { EventBus } from './events/events';
import { loadViewState, saveViewState } from './view-state/view-state';
import { loadWorkspaceConfig } from './workspace-config/workspace-config';
import { chooseWorkspace } from './workspace/workspace';

export { DocumentError } from './documents/documents';
export type { McpServerEntry, ServeTools, ToolEndpoint } from './chat/claude-cli/claude-cli';

export interface EngineOptions {
  workspace: string;
  model?: string;
  // How chat reaches Claude, decided once at startup.
  claude: ClaudeMode;
  // Model steps allowed in one chat turn. Nothing sets it yet; a future config setting will.
  maxSteps?: number;
  // Lends a call's tools to the claude program.
  serveTools: ServeTools;
}

export interface StartOptions {
  // The folder argument, if any.
  target: string | undefined;
  claude: ClaudeMode;
  model?: string;
  serveTools: ServeTools;
}

export interface Engine {
  readonly workspace: string;
  // Each rejects with DocumentError (reason 'not-found' or 'invalid') or another Error.
  readonly documents: {
    list(): Promise<DocumentEntry[]>;
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    create(path: string, kind: 'file' | 'folder'): Promise<void>;
    move(from: string, to: string): Promise<void>;
    count(path: string): Promise<FolderCount>;
    delete(path: string): Promise<void>;
  };
  readonly sessions: {
    // On a startEngine engine always valid. On a createEngine engine valid only after create().
    current(): CurrentSession<UIMessage>;
    // The new session's id.
    create(): Promise<string>;
    // Throws at once for an unknown session or a turn already in progress; every later failure arrives as an error
    // chunk inside the stream.
    chat(sessionId: string, request: ChatRequest): ReadableStream<UIMessageChunk>;
    cancel(sessionId: string): boolean;
  };
  readonly viewState: {
    load(): Promise<ViewState>;
    save(view: ViewState): Promise<void>;
  };
  readonly workspaceConfig: {
    names(): Promise<{ skills: string[]; agents: string[] }>;
  };
  readonly events: {
    subscribe(listener: (event: HostEvent) => void): () => void;
  };
}

// For tests: synchronous and no I/O. sessions.current() is valid only after sessions.create().
export function createEngine(options: EngineOptions): Engine {
  return wire(options).engine;
}

// Startup. Resolves once the stored chat is back, so the current session exists before anything is served.
export async function startEngine({ target, claude, model, serveTools }: StartOptions): Promise<Engine> {
  const workspace = await chooseWorkspace(target);
  const { engine, events, sessions } = wire({ workspace, claude, model, serveTools });
  // Tells every open tab when something in the workspace changes on disk, so it can catch up.
  watchDocuments(workspace, () => events.emit({ type: 'documents-changed' }));
  await sessions.load();
  const backend = claudeBackend(claude, serveTools);
  console.log(`3pitor chat: claude via ${backend.label}`);
  const warning = backend.startupWarning(process.env);
  if (warning) console.warn(`\n${warning}\n`);
  return engine;
}

function wire(options: EngineOptions) {
  const { workspace } = options;
  const events = new EventBus();
  const sessions = new Sessions(options, events);
  const engine: Engine = {
    workspace,
    documents: {
      list: () => listEntries(workspace),
      read: (path) => readDocument(workspace, path),
      write: (path, content) => writeDocument(workspace, path, content),
      create: (path, kind) => createEntry(workspace, path, kind),
      move: (from, to) => moveEntry(workspace, from, to),
      count: (path) => countContents(workspace, path),
      delete: (path) => deleteEntry(workspace, path),
    },
    sessions: {
      current: () => {
        const { id, uiMessages, abort } = sessions.current();
        return { id, messages: uiMessages, running: !!abort, claude: sessions.claude };
      },
      create: async () => (await sessions.create()).id,
      chat: (sessionId, request) => sessions.chat(sessionId, request),
      cancel: (sessionId) => sessions.cancel(sessionId),
    },
    viewState: { load: () => loadViewState(workspace), save: (view) => saveViewState(workspace, view) },
    workspaceConfig: {
      names: async () => {
        const config = await loadWorkspaceConfig(workspace);
        return { skills: config.skills.map((s) => s.name), agents: config.agents.map((a) => a.name) };
      },
    },
    events: { subscribe: (listener) => events.subscribe(listener) },
  };
  return { engine, events, sessions };
}
