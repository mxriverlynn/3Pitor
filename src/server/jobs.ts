// Background jobs: unattended runs where edits are auto-accepted, anything else that would prompt
// is denied, and each run is bounded by turns, budget, and a wall-clock timeout the SDK does not provide.
import { generateText } from 'ai';
import type { Job } from '../shared/wire';
import { claudeModel, claudeSessionIdOf, type ClaudeOptions } from './claude';
import type { EventBus } from './events';

export interface JobLimits {
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs?: number;
}

type RunningJob = Job & { abort: AbortController };

export class Jobs {
  private jobs = new Map<string, RunningJob>();

  constructor(
    private options: ClaudeOptions,
    private events: EventBus,
  ) {}

  start(prompt: string, limits: JobLimits = {}): Job {
    const abort = new AbortController();
    const job: RunningJob = {
      id: crypto.randomUUID(),
      prompt,
      status: 'running',
      startedAt: Date.now(),
      abort,
    };
    this.jobs.set(job.id, job);
    this.events.emit({ type: 'job-status', jobId: job.id, status: 'running' });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, limits.timeoutMs ?? 5 * 60_000);

    generateText({
      model: claudeModel(this.options, {
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
        job.claudeSessionId = claudeSessionIdOf(result.finalStep);
      })
      .catch((error) => {
        job.status = timedOut ? 'timed-out' : abort.signal.aborted ? 'cancelled' : 'failed';
        job.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        clearTimeout(timer);
        job.finishedAt = Date.now();
        this.events.emit({ type: 'job-status', jobId: job.id, status: job.status, error: job.error });
      });

    return publicJob(job);
  }

  get(id: string): Job | undefined {
    const job = this.jobs.get(id);
    return job && publicJob(job);
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') return false;
    job.abort.abort();
    return true;
  }
}

function publicJob({ abort: _abort, ...job }: RunningJob): Job {
  return job;
}
