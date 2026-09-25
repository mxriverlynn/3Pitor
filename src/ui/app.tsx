import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { marked } from 'marked';
import { MarkdownEditor, unsupportedMarkdown } from './markdown-editor';

// ---------- shared plumbing ----------

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

type HostEvent = { type: string; [key: string]: any };

// One WebSocket for host events; components subscribe to what they care about.
function useHostEvents(onEvent: (event: HostEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (msg) => handler.current(JSON.parse(msg.data));
    };
    connect();
    return () => {
      clearTimeout(retry);
      ws.onclose = null;
      ws.close();
    };
  }, []);
  return connected;
}

const md = (text: string) => ({ __html: marked.parse(text, { async: false }) as string });

// ---------- documents ----------

function useDocuments() {
  const [names, setNames] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>('notes.md');
  // `saved` is the file as it is on disk; `content` is the editor's markdown.
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  // Tracked from edits rather than by comparing text: the editor's markdown output can differ
  // from the file (bullet style, line wrapping) even when nobody changed anything.
  const [dirty, setDirty] = useState(false);
  // Bumped whenever the editor must load `saved` from scratch (open, reload from disk).
  const [version, setVersion] = useState(0);
  const [changedOnDisk, setChangedOnDisk] = useState(false);
  const unsupported = useMemo(() => unsupportedMarkdown(saved), [saved]);

  const load = (name: string, text: string) => {
    setCurrent(name);
    setContent(text);
    setSaved(text);
    setDirty(false);
    setChangedOnDisk(false);
    setVersion((v) => v + 1);
  };

  const refreshList = useCallback(async () => setNames((await api('GET', '/api/documents')).documents), []);

  const open = useCallback(async (name: string) => {
    const doc = await api('GET', `/api/documents/${encodeURIComponent(name)}`);
    load(name, doc.content ?? '');
  }, []);

  const edit = useCallback((markdown: string) => {
    setContent(markdown);
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!dirty || unsupported.length) return;
    await api('PUT', `/api/documents/${encodeURIComponent(current)}`, { content });
    setSaved(content);
    setDirty(false);
    setChangedOnDisk(false);
  }, [current, content, dirty, unsupported]);

  const create = useCallback(
    async (name: string) => {
      const file = name.endsWith('.md') ? name : `${name}.md`;
      await api('PUT', `/api/documents/${encodeURIComponent(file)}`, { content: `# ${file.replace(/\.md$/, '')}\n` });
      await refreshList();
      await open(file);
    },
    [open, refreshList],
  );

  // Called after the agent may have touched files: reload unless the user has unsaved edits.
  const syncFromDisk = useCallback(async () => {
    await refreshList();
    const doc = await api('GET', `/api/documents/${encodeURIComponent(current)}`);
    if (doc.content === undefined || doc.content === saved) return;
    if (dirty) setChangedOnDisk(true);
    else load(current, doc.content);
  }, [current, saved, dirty, refreshList]);

  useEffect(() => {
    refreshList().then(() => open('notes.md'));
  }, []);

  return { names, current, content, saved, version, edit, dirty, unsupported, changedOnDisk, open, save, create, syncFromDisk };
}

function Files({ docs }: { docs: ReturnType<typeof useDocuments> }) {
  const [draft, setDraft] = useState('');
  return (
    <aside className="files">
      <h2>Documents</h2>
      {docs.names.map((name) => (
        <button key={name} className={`file ${name === docs.current ? 'active' : ''}`} onClick={() => docs.open(name)}>
          {name}
        </button>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) docs.create(draft.trim()).then(() => setDraft(''));
        }}
        style={{ marginTop: 10 }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="new-file.md"
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', background: 'var(--panel)' }}
        />
      </form>
    </aside>
  );
}

function Editor({ docs }: { docs: ReturnType<typeof useDocuments> }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        docs.save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docs.save]);

  return (
    <section className="editor">
      <div className="editor-bar">
        <span className="name">{docs.current}</span>
        <span className="muted small">{docs.dirty ? 'unsaved changes' : 'saved'}</span>
        {docs.changedOnDisk && (
          <span className="banner">
            The agent changed this file. <a href="#" onClick={(e) => (e.preventDefault(), docs.open(docs.current))}>Reload</a> (discards your edits)
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="primary" disabled={!docs.dirty || docs.unsupported.length > 0} onClick={docs.save}>
          Save
        </button>
      </div>
      {docs.unsupported.length > 0 && (
        <div className="notice">
          Read-only: this document has {docs.unsupported.join(' and ')}, which the editor can't keep yet. Saving would damage
          them, so editing is off for this file.
        </div>
      )}
      <MarkdownEditor markdown={docs.saved} version={docs.version} readOnly={docs.unsupported.length > 0} onChange={docs.edit} />
    </section>
  );
}

// ---------- chat ----------

function toolSummary(input: any): string {
  if (!input || typeof input !== 'object') return '';
  const value = input.file_path ?? input.path ?? input.skill ?? input.subagent_type ?? input.command ?? input.pattern ?? input.description;
  return typeof value === 'string' ? value.replace(/^.*\/\.data\/[^/]+\//, '') : '';
}

function Approval({ data, resolved }: { data: any; resolved?: boolean }) {
  const answer = (allow: boolean) => api('POST', `/api/approvals/${data.approvalId}`, { allow });
  const state = resolved === undefined ? 'pending' : resolved ? 'allowed' : 'denied';
  return (
    <div className={`approval ${state}`}>
      <div className="title">{data.title}</div>
      <pre>{JSON.stringify(data.input, null, 2)}</pre>
      {state === 'pending' ? (
        <div className="actions">
          <button className="primary" onClick={() => answer(true)}>Allow</button>
          <button className="danger" onClick={() => answer(false)}>Deny</button>
        </div>
      ) : (
        <span className="small muted">{state}</span>
      )}
    </div>
  );
}

function Message({ message, approvals }: { message: UIMessage; approvals: Record<string, boolean> }) {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    return <div className="msg user">{text}</div>;
  }
  return (
    <div className="msg assistant">
      {message.parts.map((part: any, i) => {
        switch (part.type) {
          case 'text':
            return <div key={i} className="md" dangerouslySetInnerHTML={md(part.text)} />;
          case 'dynamic-tool':
          case 'tool':
            return (
              <div key={i} className="tool">
                <b>{part.toolName}</b> {toolSummary(part.input)}{' '}
                <span className="small">
                  · {part.state === 'output-available' ? 'done' : part.state === 'output-error' ? 'error' : part.state === 'output-denied' ? 'denied' : 'running'}
                </span>
              </div>
            );
          case 'data-approval':
            return <Approval key={i} data={part.data} resolved={approvals[part.data.approvalId]} />;
          case 'data-task':
            if (part.data.subtype !== 'task_started') return null;
            return (
              <div key={i} className="task">
                ↳ subagent <b>{part.data.subagentType ?? 'task'}</b> started: {part.data.description}
              </div>
            );
          case 'data-session':
            return part.data.aborted ? <div key={i} className="small muted">stopped</div> : null;
          default:
            return null;
        }
      })}
    </div>
  );
}

function Chat({
  sessionId,
  approvals,
  onTurnFinished,
  onInit,
}: {
  sessionId: string;
  approvals: Record<string, boolean>;
  onTurnFinished: () => void;
  onInit: (init: any) => void;
}) {
  const [input, setInput] = useState('');
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/sessions/${sessionId}/chat`,
        // The server resumes the Claude session itself, so it only needs the newest message.
        prepareSendMessagesRequest: ({ messages }) => {
          const last = messages.at(-1)!;
          return { body: { text: last.parts.map((p) => (p.type === 'text' ? p.text : '')).join('') } };
        },
      }),
    [sessionId],
  );
  const { messages, sendMessage, status, stop, error } = useChat({
    id: sessionId,
    transport,
    onFinish: onTurnFinished,
    onData: (part: any) => {
      if (part.type === 'data-init') onInit(part.data);
    },
  });
  const busy = status === 'submitted' || status === 'streaming';
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const send = () => {
    if (!input.trim() || busy) return;
    sendMessage({ text: input });
    setInput('');
  };
  const cancel = () => {
    api('POST', `/api/sessions/${sessionId}/cancel`);
    stop();
  };

  return (
    <>
      <div className="messages">
        {messages.length === 0 && (
          <div className="muted small">
            Try: "Fix the spelling and grammar in notes.md", "Use the doc-stats skill on notes.md", "Have the proofreader agent
            review notes.md", or "Ask the title-writer agent for a better title".
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} approvals={approvals} />
        ))}
        {status === 'submitted' && <div className="muted small">thinking…</div>}
        {error && <div className="error">{error.message}</div>}
        <div ref={bottom} />
      </div>
      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent to edit your document…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? <button className="danger" onClick={cancel}>Stop</button> : <button className="primary" onClick={send}>Send</button>}
      </div>
    </>
  );
}

// ---------- background jobs ----------

type Job = { id: string; prompt: string; status: string; text?: string; error?: string };

function Jobs({ jobs, start }: { jobs: Job[]; start: (prompt: string) => void }) {
  const [prompt, setPrompt] = useState('');
  return (
    <div className="jobs">
      <h2>Background jobs</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) start(prompt.trim());
          setPrompt('');
        }}
      >
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Create summary.md summarizing notes.md" />
        <button type="submit">Run</button>
      </form>
      {jobs.length === 0 && <div className="muted small">Jobs run unattended: edits are auto-approved, other prompts are denied.</div>}
      {jobs.map((job) => (
        <div key={job.id} className="job">
          <span className={`status ${job.status}`}>{job.status}</span> {job.prompt}
          {job.text && <div className="muted">{job.text}</div>}
          {job.error && <div className="error">{job.error}</div>}
          {job.status === 'running' && (
            <button className="danger small" style={{ marginLeft: 6 }} onClick={() => api('POST', `/api/jobs/${job.id}/cancel`)}>
              cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- app ----------

function App() {
  const docs = useDocuments();
  const [sessionId, setSessionId] = useState<string>();
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [init, setInit] = useState<any>();
  const [config, setConfig] = useState<{ skills: string[]; agents: string[] }>({ skills: [], agents: [] });

  const newSession = useCallback(async () => setSessionId((await api('POST', '/api/sessions')).id), []);
  useEffect(() => {
    newSession();
    api('GET', '/api/workspace-config').then(setConfig);
  }, []);

  const connected = useHostEvents(async (event) => {
    if (event.type === 'approval-resolved') setApprovals((a) => ({ ...a, [event.approvalId]: event.allow }));
    if (event.type === 'job-status' && event.status !== 'running') {
      const job = await api<Job>('GET', `/api/jobs/${event.jobId}`);
      setJobs((all) => all.map((j) => (j.id === job.id ? job : j)));
      docs.syncFromDisk();
    }
  });

  const startJob = async (prompt: string) => {
    const job = await api<Job>('POST', '/api/jobs', { prompt, maxTurns: 10 });
    setJobs((all) => [job, ...all]);
  };

  const isLocal = (name: string, list: string[]) => list.includes(name);

  return (
    <div className="app">
      <header className="topbar">
        <h1>aiditor spike</h1>
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
          {sessionId ? (
            <Chat key={sessionId} sessionId={sessionId} approvals={approvals} onTurnFinished={docs.syncFromDisk} onInit={setInit} />
          ) : (
            <div />
          )}
          <Jobs jobs={jobs} start={startJob} />
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
