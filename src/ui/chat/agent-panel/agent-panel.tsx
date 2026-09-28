import './agent-panel.css';

// The side panel's heading, with the button that clears the chat.
export function AgentPanel({ onClearChat }: { onClearChat: () => void }) {
  return (
    <div className="side-head">
      <h2>Agent</h2>
      <button onClick={onClearChat}>Clear Chat</button>
    </div>
  );
}
