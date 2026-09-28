// Page entry. The only file that knows about more than one feature: it owns the state that crosses
// features and wires them together, the way src/server/server.ts does for the server.
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import { useHostEvents } from './host-events';
import { useDocuments, Files, Editor } from './documents';
import { Chat, useChatSession } from './chat';
import { AgentPanel } from './agent-panel';
import type { Ask } from './markdown-editor';
import { QuestionPopup } from './question-popup';

// `more` after what the chat box already holds, a blank line between them.
const joinDraft = (draft: string, more: string) => (draft.trim() ? `${draft}\n\n${more}` : more);

export function App() {
  const docs = useDocuments();
  const [sessionId, setSessionId] = useState<string>();

  const newSession = useCallback(async () => setSessionId((await api('POST', '/api/sessions')).id), []);
  // A new chat starts with nothing highlighted.
  const newChat = () => {
    docs.showHighlights(undefined);
    newSession();
  };
  useEffect(() => {
    newSession();
  }, []);

  const chat = useChatSession({
    sessionId,
    openFile: docs.current,
    beginTurn: docs.beginTurn,
    onTurnFinished: (data) => {
      docs.applyEdited(data.edited);
      docs.showHighlights(data.highlights);
    },
  });

  // The question popup open on a pill, and what the writer typed into it.
  const [asking, setAsking] = useState<Ask & { text: string }>();
  // New highlights (a finished turn, New chat, another file) close the popup, so it never outlives its pill's
  // passage. What the writer typed in it moves to the chat box, to edit or send.
  useEffect(() => {
    if (asking?.text.trim()) chat.setDraft(joinDraft(chat.draft, `${asking.passage.label} — ${asking.text.trim()}`));
    setAsking(undefined);
  }, [docs.highlights]);

  const connected = useHostEvents(() => {});

  return (
    <div className="app">
      <header className="topbar">
        <h1>3pitor</h1>
        <span className="small muted">
          <span className={`dot ${connected ? 'on' : 'off'}`} />
          {connected ? 'events connected' : 'events disconnected'}
        </span>
        <span className="spacer" />
        <button onClick={newChat}>New chat</button>
      </header>
      <div className="main">
        <Files docs={docs} />
        <Editor docs={docs} onAsk={(ask) => setAsking({ ...ask, text: '' })} />
        <section className="side">
          <AgentPanel />
          {sessionId ? <Chat key={sessionId} chat={chat} /> : <div />}
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
    </div>
  );
}

// Tests import App without a page to render it into.
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
