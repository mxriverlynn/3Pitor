# Review Round: Choose Provider and Model

One round ran on 2026-10-13 over the first draft of [../change-plan.md](../change-plan.md). Size band: large (a new
persisted file, a changed wire payload, engine, server, CLI, and UI, and behavior-changing entries), so four
specialists were chosen. This record merges findings by substance (Pass A), marks findings that rest on an uninspected
input as Unverified and non-blocking (Pass B), and closes findings the C-N record or a direct check answers (Pass C).
Reviewer identifiers: JD (junior-developer), TE (test-engineer), UX (user-experience-designer), R (risk-analyst).

## Findings that changed the plan

| Merged finding | Raised by | Disposition |
| --- | --- | --- |
| Labels have no synchronous source; `ModelChoice` construction unpinned | JD-003, R5.1, TE §4.4 | `catalog` + `modelChoice` (D-26) |
| `config.json` written before `session.json` lets history cross providers | JD-002, R2(a) | Write order reversed (D-7); race case recorded (D-20, Risks) |
| A saved or posted level is not checked against the model; raw `effort` could fail every start | R3, R5.2 | `fitsCatalog` (D-8) |
| New chat's error has nowhere to show while a chat is loaded | UX-001 | Error shown in the picker (D-16) |
| Disabled options cannot show a reason | UX-002, JD-005 | Unavailable providers choosable, problem shown as text (D-15) |
| Picker/confirm/focus order, role, name, states, in-flight, busy unpinned | UX-003 to UX-006, JD-005, JD-010, TE §4.5, §4.7 | Eleven numbered behaviors and props pinned (D-15) |
| Header overflow, "medium" unclear, heading contents, empty state | UX-007 to UX-009, UX-012 | Header pinned (D-14) |
| Chat panel still says "Claude" on other providers | UX-010 (OQ2) | S-22 (D-21) |
| `MODEL` ignored silently contradicts D-10 | R6 | Startup warning (D-25) |
| Unit 1 test edits and edge mapping unstated | TE P1 | Mechanical edits listed; thin shim until Unit 4 (D-18) |
| `thinking` as second arg shifts every call | TE P2 | `thinking` last and optional (D-5) |
| `current()` shape, `SessionsOptions`, create returns, test env unpinned | TE P3, P4, P7, R4 | Pinned in Target State; helpers pass `ANTHROPIC_API_KEY` (D-18) |
| `--version --claude=x` precedence unpinned; command-line tests | TE P5 | Exit 2 (D-28); tests listed in Unit 4 |
| Existing UI tests broken by the picker not listed | TE P6 | Listed in Unit 6 |
| Missing behavioral tests (write failure, default reaching the model, two sessions, error help, Google reasoning, Ollama non-OK, isolation, picker rules) | TE §3, §7 | Added to Units 2 to 6 |
| `--effort` argv position unpinned | TE §3 Unit 2 | Right after `--model` (D-5) |
| `mock.module` leaks across files | TE §3 Unit 5 | Shared helper (D-18) |
| `/api/models` example contradicted its rule | JD-004 | Example fixed: a provider with a problem still lists static models |
| S-19 "Preserving" is a new interaction everyone meets | UX (preserving claims) | Relabelled Changing |
| S-3 thinking effect hidden; S-5/S-6/S-16/S-17 observers | R (preserving), JD-009 | Observers named on each entry; thinking effects under S-11 |
| `select` has no font rule | UX-013 | Added to Unit 6 |
| Model change not announced | UX-011 | Announcement in `newChat` (D-16) |
| Default path can fail on an older `claude` or an account without Haiku 5.5 | R1 | Risks entry; recovery is choosing another model |

## YAGNI candidates

| Candidate | Raised by | Disposition |
| --- | --- | --- |
| `missingKeyHelp` duplicates `problem()` | JD-007, R | Removed (D-6) |
| `thinking` on `subagentModel` | R | Removed; subagents at provider default (D-5) |
| `OLLAMA_HOST` scheme normalization | JD-008, R | Deferred (D-19) |
| `ModelChoice` labels duplicated on the wire | TE, R | Kept (D-12), built by one helper (D-26) |

## Closed by evidence

- **JD-001, Haiku 5.5 capped at 4,096 output tokens.** Checked in `node_modules/@ai-sdk/anthropic/dist/index.js`: an
  unknown `claude-` id gets 128,000 tokens and adaptive thinking; only a warning results, which D-24 removes.
- **JD-006 and R3, `xhigh`/`max` unverified per Claude model.** On 2026-10-13 all four catalog models answered at
  `max` through both the API and the installed `claude`.
- **R7, POST can choose which vendor receives documents.** The server has no origin check today and the chat route
  already sends documents; recorded as an existing exposure, out of scope (D-29).

## Unverified, non-blocking

- What OpenAI, Gemini, and Ollama do with Anthropic reasoning parts in replayed history (B-8, R2; no package installed).
- Whether each OpenAI and Gemini model accepts each offered level at the service (no live call).
- Rendered pixel widths of the header (UX-007, UX-013; not yet built).

## Round cap

Large band, cap three rounds. One round ran; no finding named a specialist whose domain was uncovered, so no second
round was needed.
