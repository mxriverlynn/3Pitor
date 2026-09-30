import type { ClaudeMode } from '../../../shared/wire';
import './agent-panel.css';

// The side panel's heading, with how chat reaches Claude once the page knows, and the button that clears the chat.
export function AgentPanel({ claude, onClearChat }: { claude?: ClaudeMode; onClearChat: () => void }) {
  return (
    <div className="side-head">
      <h2>{claude ? `Agent (${claude.toUpperCase()})` : 'Agent'}</h2>
      <button onClick={onClearChat}>Clear Chat</button>
    </div>
  );
}
