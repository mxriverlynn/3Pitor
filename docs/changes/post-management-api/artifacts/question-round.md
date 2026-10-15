# Question Round: Answers

The `han-core:junior-developer` review raised 32 questions about Option A. Each is answered below and tagged with what
settled it:

- **goal**: the stated goal answers it.
- **brief**: a finding in the context brief answers it.
- **D#**: a decision in [decision-log.md](./decision-log.md). The run made these itself under your standing instruction
  to decide without asking.

## Scope

| # | Question | Answer | Source |
|---|---|---|---|
| Q1 | Is the deliverable a document or code? | **The contract is documented now.** The later `tdd` run builds four things: the `src/posts/` package, the file store, a contract test suite, and the boundary and Bun-free checks. Wiring `posts` into `cli.ts` and `engine.ts` is integration. The cli and engine sketches show the intended shape of that wiring. | goal G7, G8; D2 |
| Q2 | Does swapping `fileSystem.watch` for `posts.watch` change today's behavior? | Not in this change. The swap is part of integration. | goal G7; D2 |
| Q3 | Does the file store go away when the database lands, or live on beside it? | The contract does not depend on the answer. The file store must be correct, but it is not tuned for a long life. | D3 |
| Q4 | How do we know a second implementation honors the contract? | A shared contract test suite, `describePostStore(name, makeStore)`, which every implementation must pass. An in-memory store is cut. | D4 |

## Identity

| # | Question | Answer | Source |
|---|---|---|---|
| Q5 | Do stored references break when ids switch from the file store to the database? | Yes. Ids are stable only within one store. Moving data from files to a database, and remapping references, are not part of the contract. Both are deferred to the system architect and to integration. | D5; F26 |
| Q6 | Is the change from `the sun/draft.md` to `the sun` acknowledged as breaking? | Yes. It is listed as a behavior change for integration. | goal G6, G7 |
| Q7 | What stops callers from depending on ids shaped like paths? | Ids stay unbranded. The contract says the file store's ids look like paths and must still be treated as opaque, and this is listed as an open risk. | D6 |
| Q8 | On a case-insensitive disk, does one post answer to two ids? | No. An id names a post only when it exactly matches the id the store handed out. The file store checks the folder's real name by listing its parent. | D7 |
| Q9 | Can `get` find a post that `list` would never show? | No. `get`, the `set*` methods, and `delete` accept only ids that `list` could return. The file store checks this. | D8 |
| Q10 | Is the workspace root a post when it holds `draft.md`? | No. The root is never a post, and `''` is `not-found`. | D8 |

## Title

| # | Question | Answer | Source |
|---|---|---|---|
| Q11 | Who owns the H1 once `setTitle` exists? | The caller. The title is stored metadata, and an H1 is only content. The store never reads or writes it. Whether the UI seeds an H1 is decided during integration. | D9 |
| Q12 | What does `title` return for a missing, invalid, or blank `.post.json`? | The folder's last segment. If that is blank, `Untitled`. The "never blank" rule holds in every case. | D10 |
| Q13 | What happens when a folder name is only spaces? | Same rule as Q12: the title falls back to `Untitled`. | D10 |

## Inputs and failure

| # | Question | Answer | Source |
|---|---|---|---|
| Q14 | Is `list` best effort? | `list` returns every post that exists for the whole call. A post created or deleted during the call may or may not appear. The file store skips a folder that disappears mid-walk and fails on any other error. | D11 |
| Q15 | What do the error messages actually say? | `not-found`: "That post no longer exists." `invalid`: "A post needs a title." Neither message carries an id or a path. | D12 |
| Q16 | Can a body be anything? | Any well-formed string, returned exactly: empty, large, NUL, or CRLF. The contract test suite proves the round trip. | D13 |
| Q17 | Does the create retry loop have an upper limit? Can two creates receive the same id? | There is no limit, and two creates never share an id. `createFolder` is exclusive, so each retry claims a new name or moves on to the next. | D14 |
| Q18 | Can create's cleanup delete someone else's files? | No. Cleanup deletes the folder only when it holds nothing but the files the store wrote. Otherwise it leaves the folder. A folder with no `draft.md` is not a post. | D15 |
| Q19 | The racing `setBody`/`delete` gap contradicts the contract. | Fixed. The file store queues every call for one post (set, delete, and its own create), so through one store, a delete is final. | D16 |

## Ordering and watch

| # | Question | Answer | Source |
|---|---|---|---|
| Q20 | What does "call order" mean? | Every call on one post through one store takes effect in the order the calls were made. That covers `setBody`, `setTitle`, and `delete`. Order across processes is undefined until OQ5 is answered. | D17 |
| Q21 | Can the file store keep the "signal after every change" promise? | Yes. The store signals after each of its own successful writes and does not depend on the watcher for them. The watcher covers other writers only. | D18 |
| Q22 | Does each `watch` call start its own subscription? Is unsubscribe needed? | Each call subscribes on its own, and unsubscribe is required. A host that stops, and every test, must be able to stop watching. | D19 |
| Q23 | Can a second process's edits reach the UI in the database store? | That is a known limit until OQ5 is answered. It is recorded as an open risk. | brief OQ5; deferral |
| Q24 | Should non-post `.md` edits fire signals? | Yes. The contract allows spurious signals, and a broad ignore rule also catches folder creates and deletes. | D20 |

## Conventions and placement

| # | Question | Answer | Source |
|---|---|---|---|
| Q25 | Does the README change? | Yes. The `tdd` run updates the package list and the import rules. | D21 |
| Q26 | Does `src/posts/` get a boundary test? | Yes. It mirrors `src/file-system/boundary.test.ts`. | D22 |
| Q27 | Is the posts package Bun-free, and could a database driver load into the engine? | The engine imports `posts.ts` with `import type` only, and the boundary test enforces that, so no implementation loads into the engine. The Bun-free scan also covers `src/posts/` except a database adapter's own folder. | D23 |
| Q28 | Why is pagination exempt from the admission rule? | It is a known exception. One author's workspace is small, a database can return every row, and the cost of a later breaking change is recorded. | D24 |
| Q29 | Does this contract get invariants and a failure table, as the precedent did? | Yes. The design template requires both sections. | goal G8 |

## Naming

| # | Question | Answer | Source |
|---|---|---|---|
| Q30 | Does `PostId` look like a name in the file store? | Yes. The file mapping says so plainly. | D6 |
| Q31 | Should `invalid` be named `blank-title`? | No, it stays `invalid`. It is documented as "an argument the store refuses; today only a blank title". | D25 |
| Q32 | What about the `documents-changed` event name, and `.post.json` showing up in git? | The event name is decided during integration. The `.post.json` file is intended: it is the title's home, and the tree hides it. | D26; goal G7 |
