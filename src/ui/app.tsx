// Page entry. The only file that knows about more than one feature: it owns the state that crosses
// features and wires them together, the way src/server/server.ts does for the server.
import { useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import type { CurrentSession, ViewState } from '../shared/wire';
import { createRoot } from 'react-dom/client';
import { api } from './components/api';
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
  // Why the chat could not be loaded, until Clear Chat starts a new one.
  const [chatError, setChatError] = useState<string>();

  // A new chat starts with nothing highlighted.
  const newChat = async () => {
    docs.showHighlights(undefined);
    setChatError(undefined);
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
  });

  // The question popup open on a pill, and what the writer typed into it.
  const [asking, setAsking] = useState<Ask & { text: string }>();
  // New highlights (a finished turn, Clear Chat, another file) close the popup, so it never outlives its pill's
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
  });
  // A turn that ended while the socket was down, before it first opened, or while the page was loading its chat, sent
  // its event to nobody.
  useEffect(() => {
    if (connected && waiting.current) recheck();
  }, [connected, started]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>3pitor</h1>
        <span className="small muted">
          <span className={`dot ${connected ? 'on' : 'off'}`} />
          {connected ? 'events connected' : 'events disconnected'}
        </span>
      </header>
      <div className="main">
        <FileTree docs={docs} busy={chat.busy} />
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
        <section className="side">
          <AgentPanel onClearChat={newChat} />
          {started ? <Chat key={started.id} chat={chat} /> : chatError ? <div className="error">{chatError}</div> : <div />}
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
