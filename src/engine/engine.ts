// The engine: everything 3pitor does that is not HTTP or WebSockets. Server code reaches it only through this
// module; it knows nothing about requests, responses, status codes, SSE framing, or sockets. It wires the feature
// objects together over one file system, which cli builds and hands in.
import type { FileSystem } from '../file-system/file-system';
import type { UIMessage, UIMessageChunk } from 'ai';
import type { ChatRequest, ClaudeMode, CurrentSession, DocumentEntry, FolderCount, HostEvent, ViewState } from '../shared/wire';
import { claudeBackend } from './chat/claude-backend/claude-backend';
import type { ServeTools } from './chat/claude-cli/claude-cli';
import { Sessions } from './chat/sessions/sessions';
import { countContents, createEntry, deleteEntry, isHiddenKey, listEntries, moveEntry, readDocument, writeDocument } from './documents/documents';
import { EventBus } from './events/events';
import { loadViewState, saveViewState } from './view-state/view-state';
import { loadWorkspaceConfig } from './workspace-config/workspace-config';

export { DocumentError } from './documents/documents';
export { WORKSPACE_FIXTURE } from './paths';
export type { McpServerEntry, ServeTools, ToolEndpoint } from './chat/claude-cli/claude-cli';

export interface EngineOptions {
  fileSystem: FileSystem;
  model?: string;
  // How chat reaches Claude, decided once at startup.
  claude: ClaudeMode;
  // Model steps allowed in one chat turn. Nothing sets it yet; a future config setting will.
  maxSteps?: number;
  // Lends a call's tools to the claude program.
  serveTools: ServeTools;
}

export interface StartOptions {
  fileSystem: FileSystem;
  claude: ClaudeMode;
  model?: string;
  serveTools: ServeTools;
}

export interface Engine {
  // Where the files live, for display only.
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
export async function startEngine({ fileSystem, claude, model, serveTools }: StartOptions): Promise<Engine> {
  const { engine, events, sessions } = wire({ fileSystem, claude, model, serveTools });
  // Tells every open tab when something in the workspace changes, so it can catch up. Each batch of changes is one
  // hint with no detail, and hidden keys, such as the app's own .3pitor/ state, are never tracked.
  fileSystem.watch(() => events.emit({ type: 'documents-changed' }), { ignore: isHiddenKey });
  await sessions.load();
  const backend = claudeBackend(claude, serveTools);
  console.log(`3pitor chat: claude via ${backend.label}`);
  const warning = backend.startupWarning(process.env);
  if (warning) console.warn(`\n${warning}\n`);
  return engine;
}

function wire(options: EngineOptions) {
  const { fileSystem } = options;
  const events = new EventBus();
  const sessions = new Sessions(options, events);
  const engine: Engine = {
    workspace: fileSystem.location,
    documents: {
      list: () => listEntries(fileSystem),
      read: (path) => readDocument(fileSystem, path),
      write: (path, content) => writeDocument(fileSystem, path, content),
      create: (path, kind) => createEntry(fileSystem, path, kind),
      move: (from, to) => moveEntry(fileSystem, from, to),
      count: (path) => countContents(fileSystem, path),
      delete: (path) => deleteEntry(fileSystem, path),
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
    viewState: { load: () => loadViewState(fileSystem), save: (view) => saveViewState(fileSystem, view) },
    workspaceConfig: {
      names: async () => {
        const config = await loadWorkspaceConfig(fileSystem);
        return { skills: config.skills.map((s) => s.name), agents: config.agents.map((a) => a.name) };
      },
    },
    events: { subscribe: (listener) => events.subscribe(listener) },
  };
  return { engine, events, sessions };
}
