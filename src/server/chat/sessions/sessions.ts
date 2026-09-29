// Chat sessions: one turn at a time per session, with the conversation kept in memory and sent with
// every turn.
import { createUIMessageStream, readUIMessageStream, stepCountIs, streamText, type ModelMessage, type UIMessage } from 'ai';
import { agentSettings, modelErrorMessage, type AgentOptions } from '../agent/agent';
import type { ChatRequest, SessionData } from '../../../shared/wire';
import type { EventBus } from '../../events/events';
import { editedTexts, turnTexts } from '../tools/tools';

export interface Session {
  id: string;
  // What the model is sent: only completed turns.
  messages: ModelMessage[];
  // What the chat panel shows: every turn, completed, stopped, or failed.
  uiMessages: UIMessage[];
  // Set from the moment a turn is accepted until its reply is recorded. Never stored.
  abort?: AbortController;
}

export const DEFAULT_CHAT_MAX_STEPS = 20;

export interface SessionsOptions extends AgentOptions {
  // Model steps allowed in one chat turn; DEFAULT_CHAT_MAX_STEPS when unset.
  maxSteps?: number;
}

export class Sessions {
  private sessions = new Map<string, Session>();

  constructor(
    private options: SessionsOptions,
    private events: EventBus,
  ) {}

  create(): Session {
    const session: Session = { id: crypto.randomUUID(), messages: [], uiMessages: [] };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  // One chat turn. Returns an AI SDK UI message stream that carries the model output plus our own data
  // parts (subagent tasks, and the session part: whether the turn was stopped, what it edited, and what
  // it highlighted). `openFile` is the document open in the editor; the turn tells the model about it,
  // and the history keeps that per turn.
  chat(sessionId: string, { text, openFile, documents = {} }: ChatRequest): ReadableStream {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`unknown session ${sessionId}`);
    if (session.abort) throw new Error(`session ${sessionId} already has a turn in progress`);

    const abort = new AbortController();
    session.abort = abort;
    session.uiMessages.push({ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] });

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const userTurn: ModelMessage = openFile
          ? {
              role: 'user',
              content: [
                { type: 'text', text },
                { type: 'text', text: `The file open in my editor is ${openFile}. When my message does not name a file, it means this file.` },
              ],
            }
          : { role: 'user', content: text };
        const messages: ModelMessage[] = [...session.messages, userTurn];
        const turn = turnTexts(this.options.workspace, documents);
        let streamFailed = false;
        const result = streamText({
          ...(await agentSettings(this.options, this.events, sessionId, turn, writer)),
          messages,
          stopWhen: stepCountIs(this.options.maxSteps ?? DEFAULT_CHAT_MAX_STEPS),
          abortSignal: abort.signal,
          // Replaces the AI SDK's default, which prints the whole error with its stack trace.
          onError: ({ error }) => {
            streamFailed = true;
            console.error(modelErrorMessage(error));
          },
        });
        writer.merge(result.toUIMessageStream({ onError: modelErrorMessage }));

        // The AI SDK only throws on a stop before the first step finishes; after that it resolves
        // normally, so the abort signal is the only reliable test. A stopped turn is forgotten.
        try {
          const responseMessages = await result.responseMessages;
          if (!abort.signal.aborted) session.messages = [...messages, ...responseMessages];
        } catch (error) {
          // The stream already showed its error in the chat; throwing would add a vaguer second one.
          if (streamFailed && !abort.signal.aborted) return;
          if (!abort.signal.aborted) throw error;
        }
        const aborted = abort.signal.aborted;
        const data: SessionData = { aborted, edited: aborted ? {} : editedTexts(turn) };
        if (!aborted && turn.highlights) data.highlights = turn.highlights;
        writer.write({ type: 'data-session', data });
      },
      onError: modelErrorMessage,
    });

    // The server reads its own copy, which keeps going if the page goes away. The page's copy closes only once the
    // turn is recorded.
    const [ours, page] = stream.tee();
    const recorded = this.record(session, abort, ours);
    return page.pipeThrough(new TransformStream({ flush: () => recorded }));
  }

  // Ends every turn, however it ended: records the reply, frees the session, and announces it. A turn with no reply,
  // such as one that failed before it started, is recorded as stopped.
  private async record(session: Session, abort: AbortController, stream: ReadableStream) {
    try {
      let reply: UIMessage | undefined;
      for await (const message of readUIMessageStream({ stream })) reply = message;
      session.uiMessages.push(reply ?? stoppedReply());
    } catch (error) {
      console.error(`Could not record the turn in session ${session.id}: ${(error as Error).message}`);
    } finally {
      session.abort = undefined;
      this.events.emit({ type: 'turn-finished', sessionId: session.id, aborted: abort.signal.aborted });
    }
  }

  cancel(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.abort) return false;
    session.abort.abort();
    return true;
  }
}

const stoppedReply = (): UIMessage => ({
  id: crypto.randomUUID(),
  role: 'assistant',
  parts: [{ type: 'data-session', data: { aborted: true, edited: {} } satisfies SessionData }],
});
