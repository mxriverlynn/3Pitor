// Page entry. The only file that knows about more than one feature: it owns the state that crosses
// features and wires them together, the way src/server/server.ts does for the server.
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import { useHostEvents } from './host-events';
import { useDocuments, Files, Editor } from './documents';
import { Chat } from './chat';
import { AgentPanel } from './agent-panel';

function App() {
  const docs = useDocuments();
  const [sessionId, setSessionId] = useState<string>();
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});

  const newSession = useCallback(async () => setSessionId((await api('POST', '/api/sessions')).id), []);
  useEffect(() => {
    newSession();
  }, []);

  const connected = useHostEvents((event) => {
    if (event.type === 'approval-resolved') setApprovals((a) => ({ ...a, [event.approvalId]: event.allow }));
  });

  return (
    <div className="app">
      <header className="topbar">
        <h1>3pitor</h1>
        <span className="small muted">
          <span className={`dot ${connected ? 'on' : 'off'}`} />
          {connected ? 'events connected' : 'events disconnected'}
        </span>
        <span className="spacer" />
        <button onClick={newSession}>New chat</button>
      </header>
      <div className="main">
        <Files docs={docs} />
        <Editor docs={docs} />
        <section className="side">
          <AgentPanel />
          {sessionId ? (
            <Chat
              key={sessionId}
              sessionId={sessionId}
              approvals={approvals}
              openFile={docs.current}
              beginTurn={docs.beginTurn}
              onTurnFinished={docs.applyEdited}
            />
          ) : (
            <div />
          )}
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
