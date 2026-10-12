// Page entry. The only file that knows about more than one feature: it owns the state that crosses
// features and wires them together, the way src/server/server.ts's startServer does for the server.
import { useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import type { CurrentSession, ViewState } from '../shared/wire';
import { createRoot } from 'react-dom/client';
import { api } from './components/api';
import { ErrorIcon } from './components/notice-icons';
import { PanelResizer } from './components/panel-resizer/panel-resizer';
import { useHostEvents } from './events/host-events';
import { useDocuments, Editor } from './documents/documents/documents';
import { FileTree } from './documents/file-tree/file-tree';
import { Chat, type ChatStart, useChatSession } from './chat/chat/chat';
import { AgentPanel } from './chat/agent-panel/agent-panel';
import type { Ask, SelectionAsk } from './documents/markdown-editor/markdown-editor';
import { QuestionPopup } from './popups/question-popup/question-popup';
import { SelectionPopup } from './popups/selection-popup/selection-popup';

// `more` after what the chat box already holds, a blank line between them.
const joinDraft = (draft: string, more: string) => (draft.trim() ? `${draft}\n\n${more}` : more);

export function App() {
  const docs = useDocuments();
  const [started, setStarted] = useState<ChatStart>();
  // Why the chat could not be loaded, until New chat starts a new one.
  const [chatError, setChatError] = useState<string>();
  // True once the writer has started a new chat, whose chat box then takes focus.
  const [focusChat, setFocusChat] = useState(false);
  // How wide the Documents tree is, in pixels; dragging the bar beside it changes it. It stays wide enough to show a
  // name, and narrow enough not to crowd out the editor.
  const [treeWidth, setTreeWidth] = useState(170);
  // How wide the Agent panel is, in pixels; dragging the bar beside it changes it. It stays wide enough for a chat
  // message to read, and narrow enough not to crowd out the editor.
  const [agentWidth, setAgentWidth] = useState(400);

  // A new chat starts with nothing highlighted, and nothing to undo.
  const newChat = async () => {
    docs.dismissReview();
    setChatError(undefined);
    setFocusChat(true);
    setStarted({ id: (await api('POST', '/api/sessions')).id, messages: [], waiting: false });
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
        const { id, messages, running } = await session;
        setStarted({ id, messages, waiting: running });
        if (!running) docs.applyPending(messages);
      } catch (error) {
        setChatError(`Could not load the chat: ${(error as Error).message}`);
      }
    })();
  }, []);

  const chat = useChatSession({
    chat: started,
    openFile: docs.current,
    beginTurn: docs.beginTurn,
    onTurnFinished: (messageId, data) => docs.applyTurn(messageId, data),
    onTurnProgress: (data) => docs.applyProgress(data),
  });

  // The question popup open on a pill, and what the writer typed into it.
  const [asking, setAsking] = useState<Ask & { text: string }>();
  // New highlights (a finished turn, New chat, another file) close the popup, so it never outlives its pill's
  // passage. What the writer typed in it moves to the chat box, to edit or send.
  useEffect(() => {
    if (asking?.text.trim()) chat.setDraft(joinDraft(chat.draft, `${asking.passage.label} — ${asking.text.trim()}`));
    setAsking(undefined);
  }, [docs.highlights]);

  // The popup open on the button beside a selection. Only one popup shows at a time.
  const [askingAbout, setAskingAbout] = useState<SelectionAsk>();

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
    if (event.type === 'documents-changed') docs.syncWithDisk();
  });
  // A turn that ended while the socket was down, before it first opened, or while the page was loading its chat, sent
  // its event to nobody.
  useEffect(() => {
    if (connected && waiting.current) recheck();
  }, [connected, started]);
  // Changes on disk while the socket was down sent their events to nobody, so each connect catches up.
  useEffect(() => {
    if (connected) docs.syncWithDisk();
  }, [connected]);

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
      <div className="main" style={{ '--tree-width': `${treeWidth}px`, '--agent-width': `${agentWidth}px` } as React.CSSProperties}>
        <FileTree docs={docs} busy={chat.busy} />
        <PanelResizer label="Resize the Documents tree" width={treeWidth} min={120} max={600} onResize={setTreeWidth} />
        <Editor
          docs={docs}
          onAsk={(ask) => {
            setAskingAbout(undefined);
            setAsking({ ...ask, text: '' });
          }}
          onAskSelection={(ask) => {
            setAsking(undefined);
            setAskingAbout(ask);
          }}
          askingSelection={!!askingAbout}
        />
        <PanelResizer label="Resize the Agent panel" width={agentWidth} min={280} max={800} panelOn="right" onResize={setAgentWidth} />
        <section className="side">
          <AgentPanel onNewChat={newChat} busy={chat.busy} empty={chat.messages.length === 0 && !chat.draft.trim()} />
          {started ? <Chat key={started.id} chat={chat} autoFocus={focusChat} /> : chatError ? (
            <div className="notice error" role="alert">
              <ErrorIcon />
              {chatError}
            </div>
          ) : (
            <div />
          )}
        </section>
      </div>
      {asking && (
        <QuestionPopup
          key={asking.passage.label}
          passage={asking.passage}
          anchor={asking.anchor}
          busy={chat.busy}
          text={asking.text}
          onText={(text) => setAsking({ ...asking, text })}
          onSend={(message) => {
            if (chat.send(message)) setAsking(undefined);
          }}
          onClose={() => setAsking(undefined)}
        />
      )}
      {askingAbout && (
        <SelectionPopup
          key={askingAbout.markdown}
          markdown={askingAbout.markdown}
          anchor={askingAbout.anchor}
          busy={chat.busy}
          onSend={(message) => {
            if (chat.send(message)) setAskingAbout(undefined);
          }}
          onClose={() => setAskingAbout(undefined)}
        />
      )}
    </div>
  );
}

// Tests import App without a page to render it into.
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
