import { useEffect, useState } from 'react';
import { api } from './api';
import './agent-panel.css';

const isLocal = (name: string, list: string[]) => list.includes(name);

// Skills and agents the session reported, with the ones this workspace or app defines highlighted.
export function AgentPanel({ init }: { init: any }) {
  const [config, setConfig] = useState<{ skills: string[]; agents: string[] }>({ skills: [], agents: [] });
  useEffect(() => {
    api('GET', '/api/workspace-config').then(setConfig);
  }, []);

  return (
    <div className="side-head">
      <h2>Agent</h2>
      {init ? (
        <div className="small">
          <div className="chips">
            {init.skills.map((s: string) => (
              <span key={s} className={`chip ${isLocal(s, config.skills) ? 'local' : ''}`}>/{s}</span>
            ))}
          </div>
          <div className="chips">
            {init.agents.map((a: string) => (
              <span key={a} className={`chip ${isLocal(a, config.agents) ? 'local' : ''}`}>@{a}</span>
            ))}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>Highlighted: defined by this workspace or app.</div>
        </div>
      ) : (
        <div className="muted small">Skills and agents appear after the first message.</div>
      )}
    </div>
  );
}
