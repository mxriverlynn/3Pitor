import { useRef, useState } from 'react';
import type { ModelChoice } from '../../../shared/wire';
import { ConfirmDialog } from '../../components/confirm-dialog/confirm-dialog';
import './agent-panel.css';

// The chat panel's heading, which names the current provider and model, and its New chat button. New chat is off while Claude works; in a chat that holds
// anything (a message, a draft, an attached passage) it asks first, since the old chat cannot be reached again.
export function AgentPanel({ model, onNewChat, busy, empty }: { model?: ModelChoice; onNewChat: () => void; busy: boolean; empty: boolean }) {
  const [asking, setAsking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <div className="side-head">
      <div className="model">
        <h2>{model?.providerLabel ?? 'Chat'}</h2>
        {model && <span className="access">{model.access === 'local' ? 'Local' : 'API'}</span>}
        {model && <span className="model-name">{model.thinking ? `${model.modelLabel} · ${model.thinking} thinking` : model.modelLabel}</span>}
      </div>
      <button ref={button} className="ghost" disabled={busy} aria-describedby="chat-status" onClick={() => (empty ? onNewChat() : setAsking(true))}>
        New chat
      </button>
      {asking && (
        <ConfirmDialog
          title="Start a new chat?"
          body="This ends the conversation for good and removes Claude's highlights and Undo all. Your posts stay as they are."
          confirm="New chat"
          onConfirm={() => {
            setAsking(false);
            onNewChat();
          }}
          onCancel={() => {
            setAsking(false);
            button.current!.focus();
          }}
        />
      )}
    </div>
  );
}
