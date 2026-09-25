// Transport-agnostic session host. Nothing in here knows about HTTP or WebSockets:
// the server maps these methods and events onto routes and sockets.
import { createUIMessageStream, generateText, streamText, type UIMessageStreamWriter } from 'ai';
import { claudeCode, type ClaudeCodeSettings } from 'ai-sdk-provider-claude-code';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

export type HostEvent =
  | { type: 'approval-request'; sessionId: string; approvalId: string; toolName: string; title: string; input: unknown }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string; allow: boolean }
  | { type: 'task'; sessionId: string; subtype: string; description?: string; subagentType?: string }
  | { type: 'init'; sessionId: string; skills: string[]; agents: string[]; slashCommands: string[] }
  | { type: 'turn-finished'; sessionId: string; claudeSessionId?: string; aborted: boolean }
  | { type: 'job-status'; jobId: string; status: JobStatus; error?: string };

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out';

export interface Job {
  id: string;
  prompt: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  text?: string;
  error?: string;
  claudeSessionId?: string;
}

interface Session {
  id: string;
  claudeSessionId?: string;
  abort?: AbortController;
}

interface PendingApproval {
  sessionId: string;
  resolve: (allow: boolean) => void;
}

export interface AgentHostOptions {
  workspace: string;
  model?: string;
  approvalTimeoutMs?: number;
}

type Listener = (event: HostEvent) => void;

// Subagents defined in code rather than in the workspace's .claude/agents folder.
// background: false keeps a subagent inside the turn that started it. Subagents run in the
// background by default, so the turn can end first and the result leaks into the next turn.
export const CUSTOM_AGENTS: NonNullable<ClaudeCodeSettings['agents']> = {
  'title-writer': {
    background: false,
    description: 'Suggests a better title for a markdown document. Use when asked for a title suggestion.',
    prompt: 'Read the document and reply with one line: "TITLE SUGGESTION: <title>". Do not edit files.',
    tools: ['Read'],
  },
};

export class AgentHost {
  private sessions = new Map<string, Session>();
  private jobs = new Map<string, Job & { abort: AbortController }>();
  private approvals = new Map<string, PendingApproval>();
  private listeners = new Set<Listener>();

  constructor(private options: AgentHostOptions) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: HostEvent) {
    for (const listener of this.listeners) listener(event);
  }

  createSession(): Session {
    const session: Session = { id: crypto.randomUUID() };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  // One chat turn. Returns an AI SDK UI message stream that carries the model output
  // plus our own data parts (approvals, init info, the Claude session id).
  chat(sessionId: string, text: string): ReadableStream {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`unknown session ${sessionId}`);
    if (session.abort) throw new Error(`session ${sessionId} already has a turn in progress`);

    const abort = new AbortController();
    session.abort = abort;

    return createUIMessageStream({
      execute: async ({ writer }) => {
        const result = streamText({
          model: claudeCode(this.options.model ?? 'haiku', {
            ...this.baseSettings(sessionId, writer),
            permissionMode: 'default',
            resume: session.claudeSessionId,
            canUseTool: (toolName, input, opts) => this.requestApproval(sessionId, toolName, input, opts, writer),
          }),
          prompt: text,
          abortSignal: abort.signal,
        });
        writer.merge(result.toUIMessageStream());

        let aborted = false;
        try {
          const finalStep = await result.finalStep;
          session.claudeSessionId =
            (finalStep.providerMetadata?.['claude-code']?.sessionId as string | undefined) ?? session.claudeSessionId;
        } catch (error) {
          aborted = abort.signal.aborted;
          if (!aborted) throw error;
        } finally {
          session.abort = undefined;
          this.denyPending(sessionId);
        }
        writer.write({ type: 'data-session', data: { claudeSessionId: session.claudeSessionId, aborted } });
        this.emit({ type: 'turn-finished', sessionId, claudeSessionId: session.claudeSessionId, aborted });
      },
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    });
  }

  cancel(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.abort) return false;
    session.abort.abort();
    return true;
  }

  resolveApproval(approvalId: string, allow: boolean): boolean {
    const pending = this.approvals.get(approvalId);
    if (!pending) return false;
    this.approvals.delete(approvalId);
    pending.resolve(allow);
    this.emit({ type: 'approval-resolved', sessionId: pending.sessionId, approvalId, allow });
    return true;
  }

  // An unattended run: edits are auto-accepted, anything else that would prompt is denied,
  // and it is bounded by turns, budget, and a wall-clock timeout the SDK does not provide.
  startJob(prompt: string, limits: { maxTurns?: number; maxBudgetUsd?: number; timeoutMs?: number } = {}): Job {
    const abort = new AbortController();
    const job: Job & { abort: AbortController } = {
      id: crypto.randomUUID(),
      prompt,
      status: 'running',
      startedAt: Date.now(),
      abort,
    };
    this.jobs.set(job.id, job);
    this.emit({ type: 'job-status', jobId: job.id, status: 'running' });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, limits.timeoutMs ?? 5 * 60_000);

    generateText({
      model: claudeCode(this.options.model ?? 'haiku', {
        ...this.baseSettings(job.id),
        permissionMode: 'acceptEdits',
        permissionPrompts: 'none',
        maxTurns: limits.maxTurns ?? 10,
        maxBudgetUsd: limits.maxBudgetUsd ?? 0.5,
      }),
      prompt,
      abortSignal: abort.signal,
    })
      .then((result) => {
        job.status = 'succeeded';
        job.text = result.text;
        job.claudeSessionId = result.finalStep.providerMetadata?.['claude-code']?.sessionId as string | undefined;
      })
      .catch((error) => {
        job.status = timedOut ? 'timed-out' : abort.signal.aborted ? 'cancelled' : 'failed';
        job.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        clearTimeout(timer);
        job.finishedAt = Date.now();
        this.emit({ type: 'job-status', jobId: job.id, status: job.status, error: job.error });
      });

    return this.publicJob(job);
  }

  getJob(id: string): Job | undefined {
    const job = this.jobs.get(id);
    return job && this.publicJob(job);
  }

  cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') return false;
    job.abort.abort();
    return true;
  }

  private publicJob({ abort: _abort, ...job }: Job & { abort: AbortController }): Job {
    return job;
  }

  // Settings shared by chat turns and jobs: run in the document workspace, load only
  // that workspace's .claude/ config (skills, agents, commands), and report task events.
  private baseSettings(ownerId: string, writer?: UIMessageStreamWriter): ClaudeCodeSettings {
    return {
      cwd: this.options.workspace,
      // Keep every subagent and shell command inside the turn that started it. Without this the
      // model can background a subagent, end the turn early, and the result lands in the next turn.
      env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' },
      settingSources: ['project'],
      skills: 'all',
      agents: CUSTOM_AGENTS,
      onSdkMessage: (message) => {
        if (message.type !== 'system' || message.subtype !== 'init') return;
        const event: HostEvent = {
          type: 'init',
          sessionId: ownerId,
          skills: message.skills ?? [],
          agents: message.agents ?? [],
          slashCommands: message.slash_commands ?? [],
        };
        writer?.write({ type: 'data-init', data: event });
        this.emit(event);
      },
      onTaskEvent: (task) => {
        const event: HostEvent = {
          type: 'task',
          sessionId: ownerId,
          subtype: task.subtype,
          description: 'description' in task ? task.description : undefined,
          subagentType: 'subagentType' in task ? task.subagentType : undefined,
        };
        writer?.write({ type: 'data-task', data: event });
        this.emit(event);
      },
    };
  }

  private requestApproval(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    opts: { title?: string; signal: AbortSignal },
    writer: UIMessageStreamWriter,
  ): Promise<PermissionResult> {
    const approvalId = crypto.randomUUID();
    const event: HostEvent = {
      type: 'approval-request',
      sessionId,
      approvalId,
      toolName,
      title: opts.title ?? `Allow ${toolName}?`,
      input,
    };

    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(
        () => this.resolveApproval(approvalId, false),
        this.options.approvalTimeoutMs ?? 5 * 60_000,
      );
      this.approvals.set(approvalId, {
        sessionId,
        resolve: (allow) => {
          clearTimeout(timer);
          resolve(
            allow
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: 'The user denied this action.' },
          );
        },
      });
      opts.signal.addEventListener('abort', () => this.resolveApproval(approvalId, false), { once: true });
      writer.write({ type: 'data-approval', data: event });
      this.emit(event);
    });
  }

  private denyPending(sessionId: string) {
    for (const [approvalId, pending] of this.approvals) {
      if (pending.sessionId === sessionId) this.resolveApproval(approvalId, false);
    }
  }
}
