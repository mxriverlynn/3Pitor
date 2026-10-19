// Page entry. The only file that knows about more than one feature: it owns the state that crosses
// features and wires them together, the way src/server/server.ts's startServer does for the server.
import { useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import type { CurrentSession, ModelChoice, ModelSelection, ViewState } from '../shared/wire';
import { createRoot } from 'react-dom/client';
import { api } from './components/api';
import { ErrorIcon } from './components/notice-icons';
import { PanelResizer } from './components/panel-resizer/panel-resizer';
import { useHostEvents } from './events/host-events';
import { useDocuments, Editor } from './documents/documents/documents';
import { PostPanel } from './documents/post-panel/post-panel';
import { HeadingsPanel } from './documents/headings-panel/headings-panel';
import { Chat, type ChatStart, composeMessage, useChatSession } from './chat/chat/chat';
import { AgentPanel } from './chat/agent-panel/agent-panel';

export function App() {
  const docs = useDocuments();
  const [started, setStarted] = useState<ChatStart>();
  // Why the chat could not be loaded, until New chat starts a new one.
  const [chatError, setChatError] = useState<string>();
  // True once the writer has started a new chat, whose chat box then takes focus.
  const [focusChat, setFocusChat] = useState(false);
  // How wide the post panel is, in pixels; dragging the bar beside it changes it. It stays wide enough to show a
  // name, and narrow enough not to crowd out the editor.
  const [treeWidth, setTreeWidth] = useState(300);
  // The heading the writer last chose in the Outline box, for the editor to go to.
  const [goTo, setGoTo] = useState<{ heading: number }>();
  // How wide the chat panel is, in pixels; dragging the bar beside it changes it. It stays wide enough for a chat
  // message to read, and narrow enough not to crowd out the editor.
  const [agentWidth, setAgentWidth] = useState(400);
  // Where the editor draws the post header, across the window above both panels; null until it mounts.
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);

  // The current chat's provider, model, and thinking, for the header; undefined until the chat loads.
  const [model, setModel] = useState<ModelChoice>();
  // A new chat on `selection` starts with nothing highlighted, and nothing to undo. Nothing changes until the server has
  // started it; a failure rejects with the server's reason, for the picker to show.
  const newChat = async (selection: ModelSelection) => {
    const created = await api<{ id: string; model: ModelChoice }>('POST', '/api/sessions', { selection });
    docs.dismissReview();
    setChatError(undefined);
    setFocusChat(true);
    setModel(created.model);
    setStarted({ id: created.id, messages: [], waiting: false });
    chat.announce(`New chat with ${describe(created.model)}.`);
  };
  // The page comes back as it was: the editor's view first, then the server's current chat, still working if its turn
  // is. A reply that finished while no page was there is applied once the chat is back.
  useEffect(() => {
    const session = api<CurrentSession<UIMessage>>('GET', '/api/sessions/current');
    const view = api<ViewState>('GET', '/api/view-state');
    (async () => {
      try {
        await docs.restore(await view);
      } catch (error) {
        docs.restoreFailed(error as Error);
      }
      try {
        const { id, messages, running, model } = await session;
        setModel(model);
        setStarted({ id, messages, waiting: running });
        if (!running) docs.applyPending(messages);
      } catch (error) {
        setChatError(`Could not load the chat: ${(error as Error).message}`);
      }
    })();
  }, []);

  const chat = useChatSession({
    chat: started,
    assistant: model?.providerLabel,
    openFile: docs.current,
    beginTurn: docs.beginTurn,
    onTurnFinished: (messageId, data) => docs.applyTurn(messageId, data),
    onTurnProgress: (data) => docs.applyProgress(data),
  });

  // A question chip lasts while the highlights still hold its question. When they stop (a finished turn, New chat,
  // another file), what the writer typed keeps the question's label, so the answer still says what it answers.
  useEffect(() => {
    const context = chat.context;
    if (context?.kind !== 'question' || docs.highlights.some((p) => p.label === context.passage.label)) return;
    if (chat.draft.trim()) chat.setDraft(composeMessage(chat.draft, context));
    chat.clearContext();
    chat.announce("The question chip was removed because Claude's highlights changed.");
  }, [docs.highlights]);

  // A chat waiting on a turn begun before the reload asks the server again, rather than trusting one event: once the
  // turn has ended, the chat takes the stored messages.
  const waiting = useRef(false);
  waiting.current = chat.waiting;
  const sessionId = useRef<string>(undefined);
  sessionId.current = started?.id;
  const recheck = async () => {
    const { id, messages, running } = await api<CurrentSession<UIMessage>>('GET', '/api/sessions/current');
    if (running || !waiting.current || id !== sessionId.current) return;
    chat.setMessages(messages);
    chat.setWaiting(false);
    docs.applyPending(messages);
  };
  const connected = useHostEvents((event) => {
    if (event.type === 'turn-finished' && event.sessionId === sessionId.current && waiting.current) recheck();
    if (event.type === 'posts-changed') docs.syncWithDisk();
  });
  // A turn that ended while the socket was down, before it first opened, or while the page was loading its chat, sent
  // its event to nobody.
  useEffect(() => {
    if (connected && waiting.current) recheck();
  }, [connected, started]);
  // Getting back in touch after losing it is announced; the banner going is not something a screen reader hears.
  const lost = useRef(false);
  useEffect(() => {
    if (connected === false) lost.current = true;
    else if (connected && lost.current) {
      lost.current = false;
      chat.announce('Reconnected to 3pitor.');
    }
  }, [connected]);
  // Changes on disk while the socket was down sent their events to nobody, so each connect catches up.
  useEffect(() => {
    if (connected) docs.syncWithDisk();
  }, [connected]);

  // The landing page is the post table alone, without the post panel or the chat. The post panel stays while it
  // holds unsaved changes with nowhere to be saved, since nothing else reaches them.
  const landing = docs.current === undefined;
  const postPanel = !landing || docs.missing.length > 0;

  return (
    <div className="app">
      {connected === false && (
        <div className="connection-lost" role="alert">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M2 6.5a9 9 0 0 1 12 0M4.5 9a5.5 5.5 0 0 1 7 0M7 11.5a2 2 0 0 1 2 0M2.5 2.5l11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Lost touch with 3pitor. Is it still running in your terminal? Trying again…
        </div>
      )}
      <div ref={setBarSlot} />
      <div
        className={`main ${landing ? 'landing' : ''} ${postPanel ? 'with-post-panel' : ''}`}
        style={{ '--tree-width': `${treeWidth}px`, '--agent-width': `${agentWidth}px` } as React.CSSProperties}
      >
        {postPanel && (
          <>
            <div className="left-column">
              <PostPanel docs={docs} busy={chat.busy} />
              <HeadingsPanel doc={docs.doc} onGo={(heading) => setGoTo({ heading })} />
            </div>
            <PanelResizer label="Resize the post panel" width={treeWidth} min={120} max={600} onResize={setTreeWidth} />
          </>
        )}
        <Editor
          docs={docs}
          onAsk={(passage) => chat.attach({ kind: 'question', passage })}
          onAskSelection={(markdown) => chat.attach({ kind: 'selection', markdown })}
          onAnnounce={chat.announce}
          busy={chat.busy}
          barSlot={barSlot}
          goTo={goTo}
        />
        {landing ? (
          // The chat's status line stays, so what the page announces is still heard.
          <p role="status" id="chat-status" className="visually-hidden">
            {chat.announcement}
          </p>
        ) : (
          <>
            <PanelResizer label="Resize the chat panel" width={agentWidth} min={280} max={800} panelOn="right" onResize={setAgentWidth} />
            <section className="side">
              <AgentPanel model={model} onNewChat={newChat} busy={chat.busy} empty={chat.messages.length === 0 && !chat.draft.trim() && !chat.context} />
              {started ? <Chat key={started.id} chat={chat} autoFocus={focusChat} /> : chatError ? (
                <div className="notice error" role="alert">
                  <ErrorIcon />
                  {chatError}
                </div>
              ) : (
                <div />
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// Tests import App without a page to render it into.
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);

// "Claude (API), Haiku 5.5, medium thinking", for a screen reader.
function describe({ providerLabel, access, modelLabel, thinking }: ModelChoice): string {
  return [`${providerLabel} (${access === 'local' ? 'Local' : 'API'})`, modelLabel, ...(thinking ? [`${thinking} thinking`] : [])].join(', ');
}
