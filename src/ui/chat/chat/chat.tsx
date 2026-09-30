import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from 'ai';
import { marked } from 'marked';
import type { ChatRequest, SessionData, TurnProgress } from '../../../shared/wire';
import { api } from '../../components/api';
import { AgentActions } from '../../components/agent-actions/agent-actions';
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
              <b>{getToolName(part)}</b> {toolSummary(part.input)}{' '}
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

// A chat as the page starts it: its session, the messages it already holds, and whether a turn that began before the
// page loaded is still running on the server.
export interface ChatStart {
  id: string;
  messages: UIMessage[];
  waiting: boolean;
}

// One chat session: its messages, sending, and what the chat box holds. The page owns it, so the chat panel and
// anything else the page wires (the question popup) send through the same session.
export function useChatSession({
  chat,
  onTurnFinished,
  onTurnProgress,
  openFile,
  beginTurn,
}: {
  // Undefined until the page knows its session.
  chat?: ChatStart;
  // Called with a finished turn's reply id and session data: the final markdown of every post it edited, and what it
  // highlighted.
  onTurnFinished: (messageId: string, data: SessionData) => void;
  // Called each time the running turn edits a post or changes its highlights, with what it has done so far.
  onTurnProgress?: (data: TurnProgress) => void;
  // The document open in the editor; undefined, and left out of the request, when none is.
  openFile: string | undefined;
  // What the editor holds, as markdown by file name, captured as the message is sent.
  beginTurn: () => { documents: Record<string, string> };
}) {
  const sessionId = chat?.id;
  const [draft, setDraft] = useState('');
  // Waiting on a turn the server is running for an earlier page; set from `chat` each time a new one arrives.
  const [waiting, setWaiting] = useState(chat?.waiting ?? false);
  // A new session starts with an empty chat box.
  const [started, setStarted] = useState(chat);
  if (started !== chat) {
    setStarted(chat);
    if (started?.id !== sessionId) setDraft('');
    setWaiting(chat?.waiting ?? false);
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
  // useChat reads `messages` only when `id` changes, so the page sets both together.
  const { messages, setMessages, sendMessage, status, stop, error } = useChat({
    id: sessionId,
    messages: chat?.messages,
    transport,
    onData: (part) => {
      if (part.type === 'data-progress') onTurnProgress?.(part.data as TurnProgress);
    },
    // Only a turn that ran to the end carries edits and highlights; a stopped or failed one applies nothing.
    onFinish: ({ message, isAbort, isError, isDisconnect }) => {
      if (isAbort || isError || isDisconnect) return;
      const session = message.parts.findLast((part) => part.type === 'data-session') as { data: SessionData } | undefined;
      if (session && !session.data.aborted) onTurnFinished(message.id, session.data);
    },
  });
  const busy = status === 'submitted' || status === 'streaming' || waiting;

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
  return { messages, setMessages, status, error, busy, waiting, setWaiting, draft, setDraft, send, cancel };
}

export type ChatSession = ReturnType<typeof useChatSession>;


// Shown above the chat box while a turn runs: "Working" with zero to three dots, one more every 300ms.
function WorkingBar() {
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setDots((n) => (n + 1) % 4), 300);
    return () => clearInterval(timer);
  }, []);
  return (
    <div role="status" className="working">
      Working {'.'.repeat(dots)}
    </div>
  );
}

export function Chat({ chat }: { chat: ChatSession }) {
  const { messages, status, error, busy, waiting, draft, setDraft, cancel } = chat;
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
            Type /collaborative-editing to review a draft section by section.
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {(status === 'submitted' || waiting) && <div className="muted small">thinking…</div>}
        {error && <div className="error">{error.message}</div>}
        <div ref={bottom} />
      </div>
      {busy && <WorkingBar />}
      <div className="composer">
        <AgentActions onChoose={setDraft} />
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
