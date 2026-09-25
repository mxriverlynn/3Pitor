import { expect, test } from 'bun:test';
import type { UIMessageStreamWriter } from 'ai';
import { join } from 'node:path';
import type { HostEvent } from '../shared/wire';
import { agentSettings } from './agent';
import { EventBus } from './events';
import { scriptedModel, useModel } from './test-model';
import { SRC } from './workspace';

const FIXTURE = join(SRC, 'fixtures/workspace');

test('instructs the model as a blog post editor that knows the workspace skills', async () => {
  const { instructions } = await agentSettings({ workspace: FIXTURE }, new EventBus(), 'owner-1');
  expect(instructions).toBe(
    `You are the writing assistant inside 3pitor, an editor for blog posts written in markdown. The user's posts are files in the workspace folder. Every file path you give a tool is relative to that folder; paths outside it are refused.
Read a file before you change it. Use Edit to change part of a post and Write to create or replace a whole post. Only markdown (.md) posts can be changed. If the user denies a change, do not retry it.

Skills in this workspace. When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly:
- doc-stats (.claude/skills/doc-stats/SKILL.md): Report statistics about a markdown document (heading count, line count, word count). Use when the user asks for document stats.`,
  );
});

test('leaves the skills out of the instructions when the workspace has none', async () => {
  const { instructions } = await agentSettings({ workspace: SRC + '/server' }, new EventBus(), 'owner-1');
  expect(instructions).not.toContain('Skills in this workspace');
});

test('Task runs the named subagent with its own prompt and read tools, and reports it started and finished', async () => {
  const subagent = scriptedModel([{ tool: 'Read', input: { file_path: 'notes.md' } }], 'PROOFREADER REPORT\n- none');
  useModel(subagent);
  const events: HostEvent[] = [];
  const bus = new EventBus();
  bus.subscribe((e) => events.push(e));
  const written: unknown[] = [];
  const writer = { write: (part: unknown) => written.push(part) } as unknown as UIMessageStreamWriter;

  const { tools } = await agentSettings({ workspace: FIXTURE }, bus, 'owner-1', writer);
  const input = { subagent_type: 'proofreader', description: 'Proofread notes', prompt: 'Proofread notes.md' };
  const output = await tools.Task.execute!(input, { toolCallId: 'task-1', messages: [], context: undefined });

  expect(output).toBe('PROOFREADER REPORT\n- none');
  const firstCall = subagent.doGenerateCalls[0];
  expect(firstCall.prompt[0]).toEqual({ role: 'system', content: expect.stringContaining('You are a proofreader.') });
  expect(firstCall.tools?.map((t) => t.name)).toEqual(['Read']);
  const task = { type: 'task', sessionId: 'owner-1', description: 'Proofread notes', subagentType: 'proofreader' };
  expect(events).toEqual([
    { ...task, subtype: 'task_started' },
    { ...task, subtype: 'task_notification' },
  ] as HostEvent[]);
  expect(written).toEqual(events.map((data) => ({ type: 'data-task', data })));
});

test('Task reports the subagent finished even when it fails', async () => {
  useModel(scriptedModel());
  const bus = new EventBus();
  const subtypes: string[] = [];
  bus.subscribe((e) => e.type === 'task' && subtypes.push(e.subtype));
  const { tools } = await agentSettings({ workspace: FIXTURE }, bus, 'owner-1');
  const input = { subagent_type: 'title-writer', description: 'Title', prompt: 'Suggest a title' };
  await expect(tools.Task.execute!(input, { toolCallId: 'task-1', messages: [], context: undefined })).rejects.toThrow();
  expect(subtypes).toEqual(['task_started', 'task_notification']);
});
