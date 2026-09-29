import { expect, test } from 'bun:test';
import type { UIMessageStreamWriter } from 'ai';
import { join } from 'node:path';
import type { HostEvent } from '../../../shared/wire';
import { agentSettings } from './agent';
import { EventBus } from '../../events/events';
import { scriptedModel, useModel } from '../components/test-model';
import { turnTexts } from '../tools/tools';
import { SRC } from '../../paths';
import { APP_SKILL_FILES, appSkills } from '../../workspace-config/workspace-config';
import systemPrompt from './system-prompt.md' with { type: 'text' };

const FIXTURE = join(SRC, 'fixtures/workspace');

// The app skills' lines in the instructions.
const APP_SKILL_LINE = `- collaborative-editing (3pitor://skills/collaborative-editing/SKILL.md): ${appSkills(APP_SKILL_FILES)[0].description}`;
const PROOFREAD_LINE = `- proofread (3pitor://skills/proofread/SKILL.md): ${appSkills(APP_SKILL_FILES)[1].description}`;
const RESEARCH_LINE = `- research (3pitor://skills/research/SKILL.md): ${appSkills(APP_SKILL_FILES)[2].description}`;

test('instructs the model as the blog content editor, then lists the app and workspace skills', async () => {
  const { instructions } = await agentSettings({ workspace: FIXTURE }, new EventBus(), 'owner-1', turnTexts(FIXTURE, {}));
  expect(instructions).toBe(
    `${systemPrompt.trimEnd()}

<skills>
When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly. Links inside a skill are relative to its SKILL.md's folder; Read them with the same prefix.
${APP_SKILL_LINE}
- doc-stats (.claude/skills/doc-stats/SKILL.md): Report statistics about a markdown document (heading count, line count, word count). Use when the user asks for document stats.
${PROOFREAD_LINE}
${RESEARCH_LINE}
</skills>`,
  );
});

test('gives the model web search and web fetch, run by Anthropic and capped per turn', async () => {
  const { tools } = await agentSettings({ workspace: FIXTURE }, new EventBus(), 'owner-1', turnTexts(FIXTURE, {}));

  expect(tools.web_search).toMatchObject({ id: 'anthropic.web_search_20250305', args: { maxUses: 10 } });
  expect(tools.web_fetch).toMatchObject({ id: 'anthropic.web_fetch_20250910', args: { maxUses: 10 } });
});

test('lists the app skills in the instructions when the workspace has none', async () => {
  const { instructions } = await agentSettings({ workspace: SRC + '/server' }, new EventBus(), 'owner-1', turnTexts(SRC, {}));
  expect(instructions).toContain(`\n${APP_SKILL_LINE}\n${PROOFREAD_LINE}\n${RESEARCH_LINE}`);
  expect(instructions).not.toContain('doc-stats');
});

test('Task runs the named subagent with its own prompt and read tools, and reports it started and finished', async () => {
  const subagent = scriptedModel([{ tool: 'Read', input: { file_path: 'notes.md' } }], 'PROOFREADER REPORT\n- none');
  useModel(subagent);
  const events: HostEvent[] = [];
  const bus = new EventBus();
  bus.subscribe((e) => events.push(e));
  const written: unknown[] = [];
  const writer = { write: (part: unknown) => written.push(part) } as unknown as UIMessageStreamWriter;

  const { tools } = await agentSettings({ workspace: FIXTURE }, bus, 'owner-1', turnTexts(FIXTURE, {}), writer);
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
  const { tools } = await agentSettings({ workspace: FIXTURE }, bus, 'owner-1', turnTexts(FIXTURE, {}));
  const input = { subagent_type: 'title-writer', description: 'Title', prompt: 'Suggest a title' };
  await expect(tools.Task.execute!(input, { toolCallId: 'task-1', messages: [], context: undefined })).rejects.toThrow();
  expect(subtypes).toEqual(['task_started', 'task_notification']);
});
