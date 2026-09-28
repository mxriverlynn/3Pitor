import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolOrDynamicToolName, isToolUIPart, type UIMessage } from 'ai';
import { marked } from 'marked';
import type { ChatRequest, SessionData } from '../shared/wire';
import { api } from './api';
import './chat.css';

const md = (text: string) => ({ __html: marked.parse(text, { async: false }) as string });

function toolSummary(input: any): string {
  if (!input || typeof input !== 'object') return '';
  const value = input.file_path ?? input.pattern ?? input.subagent_type;
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
        if (isToolUIPart(part)) {
          return (
            <div key={i} className="tool">
              <b>{getToolOrDynamicToolName(part)}</b> {toolSummary(part.input)}{' '}
              <span className="small">
                · {part.state === 'output-available' ? 'done' : part.state === 'output-error' ? 'error' : part.state === 'output-denied' ? 'denied' : 'running'}
              </span>
            </div>
          );
        }
        switch (part.type) {
          case 'text':
            return <div key={i} className="md" dangerouslySetInnerHTML={md(part.text)} />;
          case 'data-approval':
            return <Approval key={i} data={part.data} resolved={approvals[part.data.approvalId]} />;
          case 'data-task':
            if (part.data.subtype !== 'task_started') return null;
            return (
              <div key={i} className="task">
                ↳ subagent <b>{part.data.subagentType}</b> started: {part.data.description}
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

export function Chat({
  sessionId,
  approvals,
  onTurnFinished,
  openFile,
  beginTurn,
}: {
  sessionId: string;
  approvals: Record<string, boolean>;
  // Called with the final markdown of every post a finished turn edited.
  onTurnFinished: (edited: SessionData['edited']) => void;
  // The document open in the editor.
  openFile: string;
  // What the editor holds, as markdown by file name, captured as the message is sent.
  beginTurn: () => { documents: Record<string, string> };
}) {
  const [input, setInput] = useState('');
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/sessions/${sessionId}/chat`,
        // The server keeps the conversation itself, so it only needs the newest message.
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages.at(-1)!;
          const request: ChatRequest = {
            text: last.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''),
            openFile: body?.openFile,
            documents: body?.documents,
          };
          return { body: request };
        },
      }),
    [sessionId],
  );
  const { messages, sendMessage, status, stop, error } = useChat({
    id: sessionId,
    transport,
    // Only a turn that ran to the end carries edits; a stopped or failed one applies nothing.
    onFinish: ({ message, isAbort, isError, isDisconnect }) => {
      if (isAbort || isError || isDisconnect) return;
      const session = message.parts.findLast((part) => part.type === 'data-session') as { data: SessionData } | undefined;
      if (session && !session.data.aborted) onTurnFinished(session.data.edited);
    },
  });
  const busy = status === 'submitted' || status === 'streaming';
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const send = () => {
    if (!input.trim() || busy) return;
    sendMessage({ text: input }, { body: { openFile, ...beginTurn() } });
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
            Try: "Fix the spelling and grammar", "Use the doc-stats skill", "Have the proofreader agent review this", or "Ask
            the title-writer agent for a better title". Requests that don't name a file apply to the file open in the editor.
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
