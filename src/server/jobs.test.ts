import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from '../shared/wire';
import { EventBus } from './events';
import { Jobs, type JobLimits } from './jobs';
import { scriptedModel, useModel } from './test-model';

// Given no Claude Code: a job must not need it.
mock.module('./claude', () => ({
  claudeModel: () => {
    throw new Error('Claude Code is not available');
  },
  claudeSessionIdOf: () => undefined,
}));

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), '3pitor-jobs-'));
  await writeFile(join(workspace, 'notes.md'), '# Garden Plan\n');
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// Starts a job and waits for it to finish.
async function runJob(prompt: string, limits?: JobLimits): Promise<Job> {
  const events = new EventBus();
  const jobs = new Jobs({ workspace }, events);
  const done = new Promise<void>((resolve) =>
    events.subscribe((e) => e.type === 'job-status' && e.status !== 'running' && resolve()),
  );
  const { id } = jobs.start(prompt, limits);
  await done;
  return jobs.get(id)!;
}

test('a job edits a post with no approval, and succeeds with its reply', async () => {
  const edit = { tool: 'Edit', input: { file_path: 'notes.md', old_string: 'Garden', new_string: 'Vegetable' } };
  useModel(scriptedModel([edit], 'Renamed it.'));
  const job = await runJob('Rename the plan');
  expect([job.status, job.text, job.error]).toEqual(['succeeded', 'Renamed it.', undefined]);
  expect(await Bun.file(join(workspace, 'notes.md')).text()).toBe('# Vegetable Plan\n');
});

test('a job stops after its step limit', async () => {
  const readNotes = [{ tool: 'Read', input: { file_path: 'notes.md' } }];
  const model = scriptedModel(readNotes, readNotes, readNotes, 'Done.');
  useModel(model);
  const job = await runJob('Keep reading', { maxTurns: 2 });
  expect(job.status).toBe('succeeded');
  expect(model.doGenerateCalls.length).toBe(2);
});
