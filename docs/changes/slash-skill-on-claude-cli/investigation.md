# Investigation: A typed /skill is reported as "not installed" on the Claude Local provider

Investigation report. Read the Summary, then approve the Planned Fix or push back.

## Summary

Reader key: (E#) items are defined under Evidence Summary and (V#) items under Validation Results, both near the end of this report.

- **Root Cause:** When a chat's first message starts with `/`, 3pitor sends it to the `claude` program's stdin unchanged, and `claude` then adds a hidden note telling the model that no command by that name exists and to tell the user it is not installed (E1, E2).
- **Fix:** Wrap a lone user message whose text starts with `/` (after any leading whitespace) in the same `<message role="user">` tags that later turns already use, so `claude` never sees a leading slash (E3, E4).
- **Why Correct:** A live run of `claude` 2.1.296 with 3pitor's flags reproduces the reply's wording, and in side-by-side runs with a real Read tool the bare `/proofread` was reported "not installed" and the skill file went unread, while the wrapped text read `SKILL.md` first every time (E2, E4, E9).
- **Validation Outcome:** Validation confirmed the cause, the single code path, and that no existing test breaks; it led to three changes: a `trimStart()` guard, a second test for the open-file message shape, and a live run proving the skill now runs (V3, V5, V9).
- **Remaining Risks:** The fix relies on undocumented `claude` 2.1.296 behavior, and the live runs are small samples on Haiku; confidence is High (see Confidence Assessment).

## Problem Statement

**Symptom.** On the Claude Local provider (Haiku 5.5, medium thinking), the writer typed `/proofread` as the first message of a new chat. The model replied: "The `/proofread` command isn't installed in this session, so I did the pass directly, following the proofread steps." It still read files and made edits, but it told the writer the skill was missing.

**Expected.** `/proofread` runs the app's proofread skill (`src/skills/proofread/SKILL.md`), as the system prompt's skill list promises: "When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly."

**Conditions.**

- The provider is Claude Local (`claude-cli`), which runs the installed `claude` program.
- The message is the first in the chat, so stdin holds only that message (E3).
- The message text starts with `/`. A leading space, or any earlier message in the chat, avoids the problem (E2, E3).
- The model and thinking level do not matter to the cause. They only change how the model words its reply, and whether it still reads the skill file.
- Subagent calls go through the same code, so a subagent prompt that starts with `/` hits it too (V2).

**Impact.** All three chat actions (Proofread, Edit together, Research) put `/<skill> ` in the chat box (E5). So the main way to start a skill, from a fresh chat, hits this on Claude Local. The writer gets a false "not installed" message, and the model often skips the skill file and improvises (E9). The API-based providers are not affected, because they never go through `claude`.

## Root Cause Analysis

### Root Cause

3pitor passes a chat's first message to `claude` with its leading slash intact. `claude -p` treats a prompt that starts with `/` as a slash command. With `--disable-slash-commands` set, it injects a system reminder telling the model the command is not available and to say so.

### How the slash reaches the model

The cause runs from the chat box to the model in four steps.

1. The chat actions fill the box with `/proofread ` (E5), and the writer sends it as the first message.
2. `stdinFor` writes a lone user message to stdin as its bare text, so stdin is `/proofread` (E3).
3. 3pitor always runs `claude` with `--setting-sources ''` and `--disable-slash-commands`, which leaves `claude` with no commands at all (E1, E6). `claude` still parses the leading slash and finds no `/proofread`. It then prepends a `<system-reminder>` to the user turn: "no command with that name is available in this session ... If the task needs that command, tell the user it is not installed in this session" (E2).
4. The model now holds two conflicting instructions: 3pitor's `<skills>` block says to Read the skill file (E7), and `claude`'s reminder says the command is not installed. The reply in the screenshot does both: it follows the skill and reports it missing.

On a second or later message, stdin starts with `<history>`, so the leading slash is gone and no reminder is added (E3). That is why the bug shows only at the start of a chat.

Nothing in PR #35 caused this. The flags date from 2026-09-30 (commit 6191ffb) and the skills intro from 2026-09-29 (commit 1c3e226) (E6). The behavior depends on `claude`'s handling of a leading slash, which no test covers (E8).

## Planned Fix

### Wrap slash-led messages in `stdinFor`

In `stdinFor`, render a lone user message with `render()` — the same `<message role="user">` wrapper later turns use — whenever its text starts with `/`, so `claude` never parses it as a slash command.

### Changes

#### `src/engine/chat/claude-cli/claude-cli.ts`

- **Change:** Modify `stdinFor` (lines 259-268) so a lone message whose text starts with `/` is wrapped, and update its comment to say why.
- **Evidence:** (E2), (E3), (E4)
- **Standards:** Comments explain why, in plain sentences, above the code (inferred from surrounding code).
- **Details:**

  ```ts
  // claude cannot take another program's history, so every call replays it as text: the new message alone, or a
  // transcript of the earlier messages followed by the new one. A lone message starting with '/' is wrapped as in a
  // transcript, because claude reads a leading slash as one of its own commands and tells the model it is not installed.
  function stdinFor(prompt: LanguageModelV4Prompt): string {
    const messages = prompt.filter((m) => m.role !== 'system');
    const last = messages.at(-1);
    if (!last) return '';
    if (messages.length === 1) {
      const text = partTexts(last).join('\n');
      return text.trimStart().startsWith('/') ? render(last) : text;
    }
    const history = messages.slice(0, -1).map(render).join('\n');
    return `<history>\n${history}\n</history>\n\n${render(last)}`;
  }
  ```

  Only the slash case changes, so the existing test "a lone user message goes to stdin as it is" still holds. `trimStart()` is a guard: `claude` 2.1.296 ignores a slash after a space, tab, or newline (E2), but a later version might trim first. Wrapping such a message is harmless.

#### `src/engine/chat/claude-cli/claude-cli.test.ts`

- **Change:** Add one test next to the existing stdin tests (after line 46).
- **Evidence:** (E3), (E8)
- **Standards:** Test names state the behavior in a sentence (inferred from surrounding tests).
- **Details:**

  ```ts
  test('a lone user message starting with / goes to stdin wrapped, so claude never reads it as its own command', async () => {
    const { text } = await generateText({ model: model(), system: 'Be brief.', prompt: '/proofread echo stdin' });
    expect(text).toBe('<message role="user">\n/proofread echo stdin\n</message>');
  });

  test('a lone message with the open file added is wrapped when its text starts with /', async () => {
    const { text } = await generateText({
      model: model(),
      messages: [{ role: 'user', content: [{ type: 'text', text: '/proofread echo stdin' }, { type: 'text', text: 'The file open in my editor is a.md.' }] }],
    });
    expect(text).toBe('<message role="user">\n/proofread echo stdin\nThe file open in my editor is a.md.\n</message>');
  });
  ```

  The second test covers the shape `sessions.ts` sends when a file is open: the writer's text, then a second text part naming the file (V2).

  The fake claude replies with its stdin when stdin contains `echo stdin` (`src/engine/chat/components/fake-claude.ts:6`, `:99`).

#### Verification after the change

- Run `bun test src/engine/chat/claude-cli`.
- Run the live check scenario 'skill: collaborative-editing reads its files from the app and highlights its first stop' (`src/server/scripts/check.ts:231-258`) with Claude Local selected. It already sends `/collaborative-editing soil-draft.md` as a fresh chat's first message (V6).

## Evidence Summary

### E1: 3pitor always runs claude with no settings and slash commands disabled

- **Source:** `src/engine/chat/claude-cli/claude-cli.ts:220-226` (codebase)
- **Finding:**
  ```ts
  '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--input-format', 'text',
  '--model', modelId, ...(effort ? ['--effort', effort] : []), '--system-prompt', system, '--no-session-persistence',
  // Leave out the operator's own settings, skills, and MCP servers, which would otherwise load.
  '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config',
  '--tools', webTools ? 'WebSearch,WebFetch' : '',
  ```
- **Relevance:** `claude` has no commands of its own in this session, so any `/name` it parses is "unknown".

### E2: claude injects a "not installed" reminder before a prompt that starts with /

- **Source:** Live run of `claude` 2.1.296 from `/private/tmp`, with the E1 flags, `--model haiku`, and a system prompt asking for a verbatim echo of the user turn (codebase: reproduced in this session).
- **Finding:** Stdin `/proofread` came back as:
  ```
  <system-reminder>
  The user's message starts with the slash command /proofread, but no command with that name is available in this session, so it did not run. No slash commands are available in this session. Treat the message as a plain request and do the task with the tools you have. If the task needs that command, tell the user it is not installed in this session. The user can add it as an organization plugin or a project skill. Do not give installation steps you are not sure of. Do not say the command ran.
  </system-reminder>
  /proofread
  ```
  Stdin `/proofread notes.md please` got the same reminder. Stdin ` /proofread` (leading space), `\n/proofread`, and `\t/proofread` all came back with no reminder. A second run with a skills prompt and no echo instruction replied: "The `/proofread` command isn't installed in this session, so it didn't run." The wording closely matches the screenshot.
- **Relevance:** This reminder is the source of the "isn't installed in this session" wording, and it fires only on a leading slash.

### E3: A chat's first message goes to stdin bare; later ones are wrapped

- **Source:** `src/engine/chat/claude-cli/claude-cli.ts:261-268`, comment at `:259-260` (codebase)
- **Finding:**
  ```ts
  function stdinFor(prompt: LanguageModelV4Prompt): string {
    const messages = prompt.filter((m) => m.role !== 'system');
    const last = messages.at(-1);
    if (!last) return '';
    if (messages.length === 1) return partTexts(last).join('\n');
    const history = messages.slice(0, -1).map(render).join('\n');
    return `<history>\n${history}\n</history>\n\n${render(last)}`;
  }
  ```
- **Relevance:** Only the one-message branch can put a leading `/` at the start of stdin.

### E4: Wrapped text gets no reminder

- **Source:** Live run, same setup as E2 (codebase: reproduced in this session).
- **Finding:** Stdin `<message role="user">\n/proofread\n</message>` came back verbatim with no `<system-reminder>`. Stdin `hello\n/proofread` also got none.
- **Relevance:** Wrapping a slash-led message with the existing `render()` format is enough to stop the injection.

### E5: Every chat action starts a message with /<skill>

- **Source:** `src/ui/chat/chat/actions.tsx:8-15` (codebase)
- **Finding:**
  ```ts
  { label: 'Proofread', hint: 'Fix spelling, grammar and typos', icon: 'proofread', skill: 'proofread' },
  { label: 'Edit together', hint: 'Go through the post section by section', icon: 'collaborate', skill: 'collaborative-editing' },
  { label: 'Research', hint: 'Check claims and find sources', icon: 'research', skill: 'research' },
  ...
  export const command = (skill: string) => `/${skill} `;
  ```
- **Relevance:** The app's own buttons produce the failing input, so this is the common path, not an edge case.

### E6: The flags and the skills intro predate PR #35

- **Source:** git history (codebase): commit 6191ffb (2026-09-30) added `--setting-sources ''` and `--disable-slash-commands`; commit 1c3e226 (2026-09-29) added `SKILLS_INTRO`. `docs/changes/claude-api-or-cli-adapter/artifacts/unit-0-findings.md:25-29` records the reason: keep the operator's own 80 skills, agents, and MCP servers out.
- **Finding:**
  ```
  - **User settings, skills, and plugins load under `--system-prompt`.** The first run listed 80 skills, the user's
    agents, and four of the user's own MCP servers. Every call now also passes `--setting-sources ""`,
    `--disable-slash-commands`, and `--strict-mcp-config` ... With them, `init` lists 0 skills, 0 slash commands, and only the `3pitor` MCP server.
  ```
- **Relevance:** The flags are deliberate and should stay. The fix belongs in what 3pitor writes to stdin, not in the flags.

### E7: 3pitor tells the model to run a skill when the user types /<name>

- **Source:** `src/engine/chat/agent/agent.ts:107-119` (codebase)
- **Finding:**
  ```ts
  const SKILLS_INTRO =
    "When a request matches one, or the user types /<name>, Read its file first and follow its instructions exactly. Links inside a skill are relative to its SKILL.md's folder; Read them with the same prefix.";
  ...
  { role: 'system', content: `<skills>\n${SKILLS_INTRO}\n${lines.join('\n')}\n</skills>` },
  ```
- **Relevance:** This instruction reaches `claude` through `--system-prompt` and directly conflicts with the injected reminder (E2).

### E8: No unit test sends a /skill message on the claude-cli path

- **Source:** `src/engine/chat/claude-cli/claude-cli.test.ts:42-46`, `:63-115`; `src/engine/chat/components/fake-claude.ts`; `src/server/scripts/check.ts:240` (codebase)
- **Finding:** The stdin unit tests use `echo stdin` with no leading slash, and the fake claude has no slash handling. The live check script does send `/collaborative-editing soil-draft.md` as a first message (`check.ts:240`), but it runs against whichever real provider is configured. Whether it has ever run on Claude Local is unknown.
- **Relevance:** The unit tests never covered the leading-slash path, and the one live check that would have caught it may never have run on this provider.

### E9: With a real Read tool, the bare message skips the skill and the wrapped one runs it

- **Source:** Live runs of `claude` 2.1.296, `--model haiku --effort medium`, the E1 flags with `--tools Read`, a system prompt carrying the `SKILLS_INTRO` sentence and a `proofread` entry pointing at a copy of `src/skills/proofread/SKILL.md`, and a one-line `post.md` (codebase: reproduced in this session).
- **Finding:**
  ```
  INPUT: /proofread                                   (run 1 of 2)
  TOOL Read ['sk', 'post.md']
  RESULT: The `/proofread` command isn't available in this session, so I didn't run it. ...
  INPUT: /proofread                                   (run 2 of 2)
  TOOL Read ['sk', 'post.md']
  RESULT: The `/proofread` command isn't installed in this session, so I did this as a plain proofreading request. ...
  INPUT: <message role="user">\n/proofread\n</message>   (run 1 of 2)
  TOOL Read ['proofread', 'SKILL.md']
  TOOL Read ['sk', 'post.md']
  RESULT: I would make two edits, both in the same line of `post.md`: ...
  INPUT: <message role="user">\n/proofread\n</message>   (run 2 of 2)
  TOOL Read ['proofread', 'SKILL.md']
  TOOL Read ['sk', 'post.md']
  RESULT: I didn't edit anything. The post is one line, ... I would make two spelling fixes: ...
  ```
  An earlier bare run in the same setup read `SKILL.md` and did not mention the command, so the bare result varies run to run.
- **Relevance:** The fix does more than remove the false message: it makes the model read and follow the skill.

## Validation Results

An adversarial validator challenged the evidence, the fix, and the assumptions. Its findings, and the follow-up they triggered, are below.

### Counter-Evidence Investigated

#### V1: The model said "not installed" on its own

- **Hypothesis:** The reminder is incidental, and the model would have said this anyway.
- **Investigation:** Compared the reminder text with the screenshot; searched the repo for the phrase (`SKILLS_INTRO` at `agent.ts:107` says the opposite); checked that only the leading slash differs between inputs that do and do not get the reminder.
- **Result:** Refuted. The reminder is the cause.
- **Impact:** E2's "word for word" claim was softened to "closely matches", and E9 adds repeated runs.

#### V2: Another path puts a leading slash on claude's stdin

- **Hypothesis:** Subagents, the title-writer, or a multi-part message reach `claude` through a path the fix misses.
- **Investigation:** `stdinFor` is called only from `runClaude` (`claude-cli.ts:170`), reached through `chatModel` and `subagentModel` (`claude-program.ts:21-22`). The Task tool's `generateText({ prompt })` (`agent.ts:91`) gives a lone message, so it takes the same branch. The open-file message from `sessions.ts` is `[writer's text, "The file open in my editor…"]`, and its joined text starts with the writer's text.
- **Result:** Refuted. No uncovered path.
- **Impact:** Subagents are now named under Conditions, and a test for the open-file shape was added.

#### V3: claude trims whitespace before checking for a slash

- **Hypothesis:** A message such as `\n/proofread` still gets the reminder, so `startsWith('/')` misses it.
- **Investigation:** Live runs with `\n/proofread` and `\t/proofread` got no reminder (E2).
- **Result:** Refuted for `claude` 2.1.296.
- **Impact:** Added `trimStart()` anyway, so a later `claude` that trims first cannot bring the bug back.

#### V4: Always wrapping the lone message would be simpler

- **Hypothesis:** Wrapping every first message is more robust.
- **Investigation:** Always wrapping would change every first message and break the existing test at `claude-cli.test.ts:42-46`. The fake's `call` regex (`fake-claude.ts:67`) is multiline, so it would survive either way.
- **Result:** Confirmed that the slash-only form is the smaller change.
- **Impact:** Kept the slash-only form.

#### V5: The wrapped message may still not run the skill

- **Hypothesis:** Removing the reminder is not the same as the model following the skill.
- **Investigation:** Ran the bare and wrapped inputs side by side with a real Read tool and the skills prompt (E9). Prompt caching is unaffected, because the system prompt goes through `--system-prompt`, not stdin.
- **Result:** Refuted. The wrapped input read `SKILL.md` first in 2 of 2 runs.
- **Impact:** Added E9 and the live check step under Verification.

#### V6: A /skill message is already tested

- **Hypothesis:** E8's "no test" claim is wrong.
- **Investigation:** `check.ts:240` sends `/collaborative-editing soil-draft.md` on a fresh session, but against a real provider, not the fake.
- **Result:** Partially refuted. No unit test covers it, but a live check exists.
- **Impact:** E8 reworded, and that scenario added to Verification.

#### V7: Other providers are affected too

- **Hypothesis:** Another provider also sends text through a CLI.
- **Investigation:** `claudeCliModel` is imported only by `claude-program.ts`. `anthropic.ts:40`, `openai.ts:31`, `google.ts:32`, and `ollama.ts:25` use SDK models directly.
- **Result:** Refuted. Only Claude Local is affected.
- **Impact:** None.

#### V8: The history claims are stale

- **Hypothesis:** The commits and dates in E6 are wrong.
- **Investigation:** `git show` on 1c3e226 and 6191ffb, and `git log -S"disable-slash-commands"`. E3's line numbers were off by two.
- **Result:** Confirmed, apart from the line numbers.
- **Impact:** E3's source line corrected.

#### V9: The new test is too narrow

- **Hypothesis:** The planned test could pass without the fix, or miss the real message shape.
- **Investigation:** Without the fix, stdin is the bare string, so the test fails as it should. It did not cover the two-part open-file message.
- **Result:** Partially refuted.
- **Impact:** Added the second test.

### Adjustments Made

- `trimStart()` added to the slash check (V3).
- A second test added for the open-file message shape (V2, V9).
- A live check step added after the change (V5, V6).
- E2 wording softened, E3's lines corrected, E8 reworded, E9 added (V1, V5, V6, V8).

### Confidence Assessment

- **Confidence:** High.
- **Remaining Risks:**
  - The fix depends on undocumented slash handling in `claude` 2.1.296. A later version could change it, for example by also scanning wrapped text.
  - The E2 and E9 runs are small samples on Haiku. Other models may word things differently, though the cause is the same.
  - The test suite has not been run yet. That happens during implementation.

## Coding Standards Reference

| Standard | Source | Applies To |
| --- | --- | --- |
| Comments state why, in plain sentences, directly above the code they explain | Inferred from `src/engine/chat/claude-cli/claude-cli.ts` | `stdinFor` comment |
| Tests are named as one sentence describing the behavior, using the fake claude's stdin words | Inferred from `src/engine/chat/claude-cli/claude-cli.test.ts` | New stdin test |
| The isolating flags stay on every call | `docs/changes/claude-api-or-cli-adapter/artifacts/unit-0-findings.md:25-29` | Keeps the fix out of `claudeArgs` |

## Where the Build Departed From the Plan

- The plain-prompt and open-file cases are one test, not two. Written separately, the open-file test would pass the moment the first went green, so it could never show a red of its own.
- A third test drives the `trimStart()` guard with a message that starts with `\n `, so the guard is covered by a test that failed before it existed.
