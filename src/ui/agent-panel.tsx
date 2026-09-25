import { useEffect, useState } from 'react';
import { api } from './api';
import './agent-panel.css';

// The skills and agents this workspace and app define.
export function AgentPanel() {
  const [config, setConfig] = useState<{ skills: string[]; agents: string[] }>({ skills: [], agents: [] });
  useEffect(() => {
    api('GET', '/api/workspace-config').then(setConfig);
  }, []);

  return (
    <div className="side-head">
      <h2>Agent</h2>
      <div className="small">
        <div className="chips">
          {config.skills.map((s) => (
            <span key={s} className="chip">/{s}</span>
          ))}
        </div>
        <div className="chips">
          {config.agents.map((a) => (
            <span key={a} className="chip">@{a}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
