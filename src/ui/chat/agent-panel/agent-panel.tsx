import { useCallback, useRef, useState } from 'react';
import type { ModelChoice, ModelSelection } from '../../../shared/wire';
import { ModelPicker } from './model-picker';
import './agent-panel.css';

// The chat panel's heading, which names the current provider and model, and its New chat button. New chat opens the
// picker, which asks before ending a chat that holds anything (a message, a draft, an attached passage), since the old
// chat cannot be reached again. New chat is off while a turn runs.
export function AgentPanel({
  model,
  onNewChat,
  busy,
  empty,
}: {
  // Undefined until the current chat has loaded.
  model?: ModelChoice;
  // Rejects with the reason when the new chat cannot start.
  onNewChat: (selection: ModelSelection) => Promise<void>;
  busy: boolean;
  empty: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setPicking(false), []);
  return (
    <div className="side-head">
      <div className="model">
        <h2>{model?.providerLabel ?? 'Chat'}</h2>
        {model && <span className="access">{model.access === 'local' ? 'Local' : 'API'}</span>}
        {model && <span className="model-name">{model.thinking ? `${model.modelLabel} · ${model.thinking} thinking` : model.modelLabel}</span>}
      </div>
      <button
        ref={button}
        className="ghost"
        disabled={busy}
        aria-describedby="chat-status"
        aria-haspopup="dialog"
        aria-expanded={picking}
        onClick={() => setPicking((open) => !open)}
      >
        New chat
      </button>
      {picking && <ModelPicker opener={button.current!} busy={busy} confirmFirst={!empty} onStart={onNewChat} onClose={close} />}
    </div>
  );
}
