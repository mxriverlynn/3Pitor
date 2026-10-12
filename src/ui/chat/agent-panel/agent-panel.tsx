import { useRef, useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog/confirm-dialog';
import './agent-panel.css';

// The Claude panel's heading and its New chat button. New chat is off while Claude works; in a chat that holds
// anything (a message, a draft, an attached passage) it asks first, since the old chat cannot be reached again.
export function AgentPanel({ onNewChat, busy, empty }: { onNewChat: () => void; busy: boolean; empty: boolean }) {
  const [asking, setAsking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <div className="side-head">
      <h2>Claude</h2>
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
