import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolOrDynamicToolName, isToolUIPart, type UIMessage } from 'ai';
import { marked } from 'marked';
import type { ChatRequest, SessionData } from '../../../shared/wire';
import { api } from '../../components/api';
import './chat.css';

const md = (text: string) => ({ __html: marked.parse(text, { async: false }) as string });

function toolSummary(input: any): string {
  if (!input || typeof input !== 'object') return '';
  const value = input.file_path ?? input.pattern ?? input.subagent_type;
  return typeof value === 'string' ? value.replace(/^.*\/\.data\/[^/]+\//, '') : '';
}

function Message({ message }: { message: UIMessage }) {
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

// One chat session: its messages, sending, and what the chat box holds. The page owns it, so the chat panel and
// anything else the page wires (the question popup) send through the same session.
export function useChatSession({
  sessionId,
  onTurnFinished,
  openFile,
  beginTurn,
}: {
  sessionId?: string;
  // Called with a finished turn's session data: the final markdown of every post it edited, and what it highlighted.
  onTurnFinished: (data: SessionData) => void;
  // The document open in the editor.
  openFile: string;
  // What the editor holds, as markdown by file name, captured as the message is sent.
  beginTurn: () => { documents: Record<string, string> };
}) {
  const [draft, setDraft] = useState('');
  // A new session starts with an empty chat box.
  const [draftSession, setDraftSession] = useState(sessionId);
  if (draftSession !== sessionId) {
    setDraftSession(sessionId);
    setDraft('');
  }
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
    // Only a turn that ran to the end carries edits and highlights; a stopped or failed one applies nothing.
    onFinish: ({ message, isAbort, isError, isDisconnect }) => {
      if (isAbort || isError || isDisconnect) return;
      const session = message.parts.findLast((part) => part.type === 'data-session') as { data: SessionData } | undefined;
      if (session && !session.data.aborted) onTurnFinished(session.data);
    },
  });
  const busy = status === 'submitted' || status === 'streaming';

  // Sends `text` as the writer's message; false, and nothing sent, when there is no session, a turn is running, or
  // `text` is blank.
  const send = (text: string) => {
    if (!sessionId || busy || !text.trim()) return false;
    sendMessage({ text }, { body: { openFile, ...beginTurn() } });
    return true;
  };
  const cancel = () => {
    api('POST', `/api/sessions/${sessionId}/cancel`);
    stop();
  };
  return { messages, status, error, busy, draft, setDraft, send, cancel };
}

export type ChatSession = ReturnType<typeof useChatSession>;

export function Chat({ chat }: { chat: ChatSession }) {
  const { messages, status, error, busy, draft, setDraft, cancel } = chat;
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const send = () => {
    if (chat.send(draft)) setDraft('');
  };

  return (
    <>
      <div className="messages">
        {messages.length === 0 && (
          <div className="muted small">
            Try: "Fix the spelling and grammar", "Use the doc-stats skill", "Have the proofreader agent review this", or "Ask
            the title-writer agent for a better title". Requests that don't name a file apply to the file open in the editor.
            Type /collaborative-draft-editing to review a draft section by section.
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {status === 'submitted' && <div className="muted small">thinking…</div>}
        {error && <div className="error">{error.message}</div>}
        <div ref={bottom} />
      </div>
      <div className="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
