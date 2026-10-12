import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart, type ToolUIPart, type DynamicToolUIPart, type UIMessage } from 'ai';
import { marked } from 'marked';
import type { ChatRequest, Passage, SessionData, TurnProgress } from '../../../shared/wire';
import { api } from '../../components/api';
import { ErrorIcon } from '../../components/notice-icons';
import { ActionsMenu, Suggestions } from './actions';
import './chat.css';

const md = (text: string) => ({ __html: marked.parse(text, { async: false }) as string });

function toolSummary(input: any): string {
  if (!input || typeof input !== 'object') return '';
  const value = input.file_path ?? input.pattern ?? input.subagent_type;
  return typeof value === 'string' ? trimPath(value) : '';
}

// A workspace file's path as the writer knows it, without the folders the server keeps the workspace in.
const trimPath = (path: string) => path.replace(/^.*\/\.data\/[^/]+\//, '');

type ToolPart = ToolUIPart | DynamicToolUIPart;

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// One line for a reply's tool calls: "Read 2 files, made 3 edits", counting a Write as an edit and every other tool
// together, and " (working)" while one is still running.
export function toolLine(parts: ToolPart[]): string {
  const names = parts.map((part) => getToolName(part));
  const reads = names.filter((name) => name === 'Read').length;
  const edits = names.filter((name) => name === 'Edit' || name === 'Write').length;
  const others = names.length - reads - edits;
  const said = [
    reads && `read ${counted(reads, 'file', 'files')}`,
    edits && `made ${counted(edits, 'edit', 'edits')}`,
    others && `used ${counted(others, 'other tool', 'other tools')}`,
  ].filter(Boolean) as string[];
  const line = said.join(', ');
  const running = parts.some((part) => !part.state.startsWith('output-'));
  return line.charAt(0).toUpperCase() + line.slice(1) + (running ? ' (working)' : '');
}

// The file Claude is working on in the reply being written: the last one a tool named, if any.
export function workingFile(messages: UIMessage[]): string | undefined {
  const reply = messages.at(-1);
  if (reply?.role !== 'assistant') return;
  const path = reply.parts.findLast((part) => isToolUIPart(part) && typeof (part.input as any)?.file_path === 'string') as ToolPart | undefined;
  return path && trimPath((path.input as { file_path: string }).file_path);
}

// One tool call, as the folded tool line shows it when opened.
function ToolCall({ part }: { part: ToolPart }) {
  return (
    <div className="tool">
      <b>{getToolName(part)}</b> {toolSummary(part.input)}{' '}
      <span className="small">
        · {part.state === 'output-available' ? 'done' : part.state === 'output-error' ? 'error' : part.state === 'output-denied' ? 'denied' : 'running'}
      </span>
    </div>
  );
}

function Message({ message }: { message: UIMessage }) {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    return <div className="msg user">{text}</div>;
  }
  // Every tool call folds into one line, drawn where the first one was.
  const tools = message.parts.filter((part) => isToolUIPart(part)) as ToolPart[];
  return (
    <div className="msg assistant">
      {message.parts.map((part: any, i) => {
        if (isToolUIPart(part)) {
          if (part !== tools[0]) return null;
          return (
            <details key={i} className="tools">
              <summary>{toolLine(tools)}</summary>
              {tools.map((tool) => (
                <ToolCall key={tool.toolCallId} part={tool} />
              ))}
            </details>
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

// What a message is about, attached to the chat box as a chip: a question Claude left on a passage (only labeled
// passages have a pill to click), or a passage the writer selected.
export type ChatContext = { kind: 'question'; passage: Passage & { label: string } } | { kind: 'selection'; markdown: string };

// The message the chat box sends for `text` about `context`: the question's label first, or the selection quoted
// first. Without a context, `text` as typed.
export function composeMessage(text: string, context?: ChatContext): string {
  if (!context) return text;
  if (context.kind === 'question') return `${context.passage.label} — ${text.trim()}`;
  const quote = context.markdown
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
  return `About this passage:\n\n${quote}\n\n${text.trim()}`;
}

// A chat as the page starts it: its session, the messages it already holds, and whether a turn that began before the
// page loaded is still running on the server.
export interface ChatStart {
  id: string;
  messages: UIMessage[];
  waiting: boolean;
}

// One chat session: its messages, sending, and what the chat box holds, chip and all. The page owns it, so the chat
// panel and anything else the page wires (a question pill, the ask button) reach the same chat box.
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
  // What the message is about, shown as a chip in the chat box.
  const [context, setContext] = useState<ChatContext>();
  // How many times something asked for focus in the chat box; the chat panel focuses it on each one.
  const [focusRequests, setFocusRequests] = useState(0);
  // Waiting on a turn the server is running for an earlier page; set from `chat` each time a new one arrives.
  const [waiting, setWaiting] = useState(chat?.waiting ?? false);
  // A new session starts with an empty chat box.
  const [started, setStarted] = useState(chat);
  if (started !== chat) {
    setStarted(chat);
    if (started?.id !== sessionId) {
      setDraft('');
      setContext(undefined);
    }
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

  // What the chat's status region says to screen readers: when Claude starts, which file it moves on to, and when it
  // finishes, plus whatever the page announces.
  const [announcement, announce] = useState('');
  const working = busy ? workingFile(messages) : undefined;
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (busy) announce(working ? `Claude is working on ${working}.` : 'Claude is working.');
    else if (wasBusy.current) announce('Claude finished.');
    wasBusy.current = busy;
  }, [busy, working]);

  // Sends `text` as the writer's message, about the chip's context if there is one, and clears the chip; false, and
  // nothing sent or cleared, when there is no session, a turn is running, or `text` is blank.
  const send = (text: string) => {
    if (!sessionId || busy || !text.trim()) return false;
    sendMessage({ text: composeMessage(text, context) }, { body: { openFile, ...beginTurn() } });
    setContext(undefined);
    return true;
  };
  // Shows `next` as the chip, in place of any other, or takes the chip away; either way focus goes to the chat box.
  const attach = (next?: ChatContext) => {
    setContext(next);
    setFocusRequests((n) => n + 1);
  };
  const cancel = () => {
    api('POST', `/api/sessions/${sessionId}/cancel`);
    stop();
  };
  return {
    messages,
    setMessages,
    status,
    error,
    busy,
    waiting,
    setWaiting,
    draft,
    setDraft,
    context,
    attach,
    // Takes the chip away without moving focus, for when the writer did not ask to.
    clearContext: () => setContext(undefined),
    focusRequests,
    openFile,
    // The file Claude is working on, while it works and a tool has named one.
    working,
    announcement,
    announce,
    send,
    cancel,
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;


// The chip above the chat box: what the next message is about, and a button that takes it away.
function Chip({ context, onRemove }: { context: ChatContext; onRemove: () => void }) {
  const question = context.kind === 'question' ? context.passage : undefined;
  return (
    <div className="chip">
      {question ? (
        <b>{question.label}</b>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
      <span id="chat-chip" className={question ? 'question' : 'passage'}>
        {question ? (question.question ?? `See ${question.label} in the chat.`) : `“${firstWords(context.kind === 'selection' ? context.markdown : '')}”`}
      </span>
      <button type="button" className="ghost" aria-label={question ? `Remove ${question.label}` : 'Remove selected passage'} onClick={onRemove}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// The first few words of a passage, with an ellipsis when there are more.
function firstWords(markdown: string, count = 8): string {
  const words = markdown.split(/\s+/).filter(Boolean);
  return words.length > count ? `${words.slice(0, count).join(' ')}…` : words.join(' ');
}

export function Chat({ chat, autoFocus }: { chat: ChatSession; autoFocus?: boolean }) {
  const { messages, error, busy, draft, setDraft, context, cancel } = chat;
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (chat.focusRequests) box.current?.focus();
  }, [chat.focusRequests]);
  // An action puts its command in the chat box, then focus goes there with the caret after it, ready to add to it.
  const [chosen, setChosen] = useState(0);
  useEffect(() => {
    const area = box.current;
    if (!chosen || !area) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }, [chosen]);
  const choose = (command: string) => {
    setDraft(command);
    setChosen((n) => n + 1);
  };
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const send = () => {
    if (chat.send(draft)) setDraft('');
  };

  return (
    <>
      {/* Always in the page, so screen readers announce each change to its text. */}
      <p role="status" id="chat-status" className="visually-hidden">
        {chat.announcement}
      </p>
      <div className="messages">
        {messages.length === 0 && <Suggestions onChoose={choose} />}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {error && (
          <div className="notice error" role="alert">
            <ErrorIcon />
            {error.message}
          </div>
        )}
        <div ref={bottom} />
      </div>
      {busy && (
        <div className="status-line">
          <span className="spinner" aria-hidden="true" />
          {chat.working ? `Claude is working on ${chat.working}` : 'Claude is working…'}
        </div>
      )}
      <div className="composer">
        {context && <Chip context={context} onRemove={() => chat.attach(undefined)} />}
        <textarea
          ref={box}
          autoFocus={autoFocus}
          aria-describedby={context ? 'chat-chip' : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Message Claude"
          placeholder={chat.openFile === undefined ? 'Ask Claude…' : 'Ask Claude about this post…'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <ActionsMenu onChoose={choose} />
        {busy ? <button className="danger" onClick={cancel}>Stop</button> : <button className="primary" onClick={send}>Send</button>}
      </div>
    </>
  );
}
