// The engine: everything 3pitor does that is not HTTP or WebSockets. Server code reaches it only through this
// module; it knows nothing about requests, responses, status codes, SSE framing, or sockets. It wires the feature
// objects together over one file system, which cli builds and hands in.
import type { FileSystem } from '../file-system/file-system';
import type { UIMessage, UIMessageChunk } from 'ai';
import type { ChatRequest, CurrentSession, DocumentEntry, FolderCount, HostEvent, ModelCatalog, ModelChoice, ModelSelection, ProviderEntry, ViewState } from '../shared/wire';
import { modelChoice, providerBackends, type IsOnPath } from './chat/providers/providers';
import type { ServeTools } from './chat/claude-cli/claude-cli';
import { Sessions } from './chat/sessions/sessions';
import { countContents, createEntry, createPost, deleteEntry, isHiddenKey, listEntries, moveEntry, readDocument, writeDocument } from './documents/documents';
import { EventBus } from './events/events';
import { loadViewState, saveViewState } from './view-state/view-state';
import { loadWorkspaceConfig, type AppSkillFiles } from './workspace-config/workspace-config';
import { loadSelection } from './model-config/model-config';

export { DocumentError } from './documents/documents';
export type { McpServerEntry, ServeTools, ToolEndpoint } from './chat/claude-cli/claude-cli';
export type { AppSkillFiles } from './workspace-config/workspace-config';
export { SelectionError, type IsOnPath } from './chat/providers/providers';

export interface EngineOptions {
  fileSystem: FileSystem;
  // The app's own skills, which the host ships.
  appSkillFiles: AppSkillFiles;
  // Lends a call's tools to the claude program.
  serveTools: ServeTools;
  // Where API keys, the PATH, and OLLAMA_HOST are read from: process.env, or a test's own.
  env: Record<string, string | undefined>;
  // Whether a program is on a PATH, for the claude program's readiness.
  isOnPath: IsOnPath;
  // Model steps allowed in one chat turn. Nothing sets it yet; a future config setting will.
  maxSteps?: number;
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
    // Makes a post inside `parent` ('' for the top level) and resolves to its draft's path.
    createPost(parent: string, title: string): Promise<string>;
    move(from: string, to: string): Promise<void>;
    count(path: string): Promise<FolderCount>;
    delete(path: string): Promise<void>;
  };
  readonly sessions: {
    // On a startEngine engine always valid. On a createEngine engine valid only after create().
    current(): CurrentSession<UIMessage>;
    // The new session's id and model, on `selection` or the saved one. Rejects with SelectionError for a selection
    // that does not fit, or with the write's error.
    create(selection?: ModelSelection): Promise<{ id: string; model: ModelChoice }>;
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
  readonly models: {
    // Every provider in the picker's order, and the saved selection, read fresh on each call. Never rejects for one
    // provider: a provider whose models cannot be listed carries why as its problem.
    list(): Promise<ModelCatalog>;
  };
}

// For tests: synchronous and no I/O. sessions.current() is valid only after sessions.create().
export function createEngine(options: EngineOptions): Engine {
  return wire(options).engine;
}

// Startup. Resolves once the stored chat is back, so the current session exists before anything is served.
export async function startEngine(options: EngineOptions): Promise<Engine> {
  const { fileSystem, env, isOnPath } = options;
  const { engine, events, sessions } = wire(options);
  // Tells every open tab when something in the workspace changes, so it can catch up. Each batch of changes is one
  // hint with no detail, and hidden keys, such as the app's own .3pitor/ state, are never tracked.
  fileSystem.watch(() => events.emit({ type: 'documents-changed' }), { ignore: isHiddenKey });
  await sessions.load();
  const session = sessions.current();
  const backend = sessions.backend(session);
  console.log(`3pitor chat: ${chatLine(modelChoice(session.selection, backend))}`);
  const warning = backend.problem(env, isOnPath);
  if (warning) console.warn(`\n${warning}\n`);
  if (env.MODEL) console.warn('3pitor: MODEL is no longer read. Choose the model from New chat.');
  return engine;
}

function wire(options: EngineOptions) {
  const { fileSystem } = options;
  const events = new EventBus();
  const backends = providerBackends(options.serveTools, options.env);
  const sessions = new Sessions({ ...options, backends }, events);
  const engine: Engine = {
    workspace: fileSystem.location,
    documents: {
      list: () => listEntries(fileSystem),
      read: (path) => readDocument(fileSystem, path),
      write: (path, content) => writeDocument(fileSystem, path, content),
      create: (path, kind) => createEntry(fileSystem, path, kind),
      createPost: (parent, title) => createPost(fileSystem, parent, title),
      move: (from, to) => moveEntry(fileSystem, from, to),
      count: (path) => countContents(fileSystem, path),
      delete: (path) => deleteEntry(fileSystem, path),
    },
    sessions: {
      current: () => {
        const session = sessions.current();
        const { id, uiMessages, abort, selection } = session;
        return { id, messages: uiMessages, running: !!abort, model: modelChoice(selection, sessions.backend(session)) };
      },
      create: async (selection) => {
        const session = await sessions.create(selection);
        return { id: session.id, model: modelChoice(session.selection, sessions.backend(session)) };
      },
      chat: (sessionId, request) => sessions.chat(sessionId, request),
      cancel: (sessionId) => sessions.cancel(sessionId),
    },
    viewState: { load: () => loadViewState(fileSystem), save: (view) => saveViewState(fileSystem, view) },
    workspaceConfig: {
      names: async () => {
        const config = await loadWorkspaceConfig(fileSystem, options.appSkillFiles);
        return { skills: config.skills.map((s) => s.name), agents: config.agents.map((a) => a.name) };
      },
    },
    events: { subscribe: (listener) => events.subscribe(listener) },
    models: {
      list: async () => {
        const { fileSystem, env, isOnPath } = options;
        const providers = await Promise.all(
          Object.values(backends).map(async (backend): Promise<ProviderEntry> => {
            const { id, label, access } = backend;
            const problem = backend.problem(env, isOnPath);
            try {
              return { id, label, access, ...(problem && { problem }), models: await backend.models(env) };
            } catch (error) {
              return { id, label, access, problem: (error as Error).message, models: [] };
            }
          }),
        );
        return { providers, selected: await loadSelection(fileSystem, env, backends) };
      },
    },
  };
  return { engine, events, sessions };
}

// "Claude (API) · claude-haiku-5-5 · medium thinking", or without the level when there is none.
function chatLine({ providerLabel, access, model, thinking }: ModelChoice): string {
  const parts = [`${providerLabel} (${access === 'local' ? 'Local' : 'API'})`, model, ...(thinking ? [`${thinking} thinking`] : [])];
  return parts.join(' · ');
}
