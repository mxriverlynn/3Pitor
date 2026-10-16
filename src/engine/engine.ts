// The engine: everything 3pitor does that is not HTTP or WebSockets. Server code reaches it only through this
// module; it knows nothing about requests, responses, status codes, SSE framing, or sockets. It wires the feature
// objects together over one file system and one post store, which cli builds and hands in.
import type { FileSystem } from '../file-system/file-system';
import type { PostStore } from '../posts/posts';
import type { UIMessage, UIMessageChunk } from 'ai';
import type { ChatRequest, CurrentSession, HostEvent, ModelCatalog, ModelChoice, ModelSelection, ProviderEntry, ViewState } from '../shared/wire';
import { modelChoice, providerBackends, type IsOnPath } from './chat/providers/providers';
import type { ServeTools } from './chat/claude-cli/claude-cli';
import { Sessions } from './chat/sessions/sessions';
import { EventBus } from './events/events';
import { loadViewState, saveViewState } from './view-state/view-state';
import { loadWorkspaceConfig, type AppSkillFiles } from './workspace-config/workspace-config';
import { loadSelection } from './model-config/model-config';

export type { McpServerEntry, ServeTools, ToolEndpoint } from './chat/claude-cli/claude-cli';
export type { AppSkillFiles } from './workspace-config/workspace-config';
export { SelectionError, type IsOnPath } from './chat/providers/providers';

export interface EngineOptions {
  // App state, notes, skills, config, and the tools' Read and Glob: everything that is not a post.
  fileSystem: FileSystem;
  // Every post, built by the host over the same workspace.
  posts: PostStore;
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
  // The store the host handed in. Without watch: only the engine subscribes, so a subscription always has an owner.
  readonly posts: Omit<PostStore, 'watch'>;
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
  const { posts, env, isOnPath } = options;
  const { engine, events, sessions } = wire(options);
  // Tells every open tab when a post changes, so it can catch up. Each signal is a hint with no detail.
  // The store asks every subscriber to unsubscribe when it stops listening; nothing stops an engine that started.
  const unsubscribe = posts.watch(() => events.emit({ type: 'posts-changed' }));
  try {
    await sessions.load();
  } catch (error) {
    unsubscribe();
    throw error;
  }
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
    posts: options.posts,
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
