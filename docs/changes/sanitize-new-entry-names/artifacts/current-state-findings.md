# Current State Findings: Sanitize New File and Folder Names

## Provenance

This run's own discovery round produced these findings. No prior report covered the area. `han-core:structural-analyst`
and `han-core:behavioral-analyst` were each given the area: the Documents tree's new-file and new-folder flow in
`src/ui/documents/file-tree/file-tree.tsx`, `src/ui/documents/documents/documents.tsx`, and
`src/server/documents/documents.ts` with its routes and tests. `han-core:concurrency-analyst` was not dispatched: the
area has no shared mutable state beyond one React component's local state. The orchestrator read every cited line
itself before writing a finding.

## Project Context

- **Stack:** Bun + TypeScript, Hono on the server, React in the browser, `bun test` with Testing Library for UI tests.
- **Conventions source:** `README.md`, section "How `src/` is laid out": packages, then features, then components. A
  helper only one component imports sits beside that component.
- **ADRs found:** none found under `docs/adr/`.
- **Coding standards found:** none found.
- **Recent churn:** `206c16d` introduced the folder tree with create, rename, move, and delete. `dceed01`, `073c74b`,
  `e41c763`, `6631ec5`, `b6de90a`, and `c25cc71` changed the tree's menus, icons, and layout, not its naming.

## Gaps

- No ADR or coding standard says which characters a file or folder name may hold.
- No test types a name with spaces at its ends, so the trimming in the name dialog is not pinned
  ([C-2](#c-2-the-name-dialog-trims-once-for-create-and-rename-and-blocks-only-empty-names-and-)).
- No test covers a name that already ends in `.md`, or one ending in `.MD`.

## Findings

### C-1: The `.md` extension is added in the browser by a case-sensitive helper shared with rename

- **Claim:** `withMd` appends `.md` unless the name already ends in lower-case `.md`. New file and Rename both use it,
  and New folder does not. `Notes.MD` becomes `Notes.MD.md`.
- **Location:** `src/ui/documents/file-tree/file-tree.tsx`, `withMd`, `createItems`, and the `rename` item in `actions`.
- **Evidence:**
  ```tsx
  const withMd = (name: string) => (name.endsWith('.md') ? name : `${name}.md`);
  ...
  run: () => ask({ kind: 'name', title: 'New file', action: 'Create', initial: '', submit: (name) => create(inside(withMd(name)), 'file') }),
  ...
  run: () => ask({ kind: 'name', title: 'New folder', action: 'Create', initial: '', submit: (name) => create(inside(name), 'folder') }),
  ...
  submit: (name) => move(path, parent + (kind === 'file' ? withMd(name) : name)),
  ```
- **Raised by:** structural-analyst S-1, behavioral-analyst B-1 and B-2.
- **Confidence:** Verified.
- **Bears on:** S-1, S-2, D-3.

### C-2: The name dialog trims once for create and rename, and blocks only empty names and `/`

- **Claim:** The one name dialog serves New file, New folder, and Rename. It trims the draft at submit, and disables its
  submit button while the trimmed draft is empty or the draft holds `/`. Nothing else is stripped. Trimming happens
  before `withMd`, so `"notes .md"` keeps its inner space and becomes the file `notes .md`.
- **Location:** `src/ui/documents/file-tree/file-tree.tsx`, the `Pending` type and the name dialog's `<form>`.
- **Evidence:**
  ```tsx
  | { kind: 'name'; title: string; action: string; initial: string; submit: (name: string) => Promise<void> }
  ...
  pending.submit(draft.trim()).then(
  ...
  <button type="submit" className="primary" disabled={!draft.trim() || draft.includes('/')}>
  ```
- **Raised by:** structural-analyst S-2, behavioral-analyst B-2.
- **Confidence:** Verified.
- **Bears on:** S-2, S-3, D-2, D-5.

### C-3: The server validates a path's grammar and never rewrites a name

- **Claim:** `checkPath` refuses an empty segment, a segment starting with `.`, a segment holding `\` or NUL, and a file
  not ending in lower-case `.md`. It accepts `: * ? " < > |`, tabs and other control characters, and spaces or dots at a
  name's ends. Create and move both reach it through `locate`. The server never trims, strips, or appends.
- **Location:** `src/server/documents/documents.ts`, `checkPath` and `locate`.
- **Evidence:**
  ```ts
  const valid = segments.every((s) => s !== '' && !s.startsWith('.') && !/[\\\0]/.test(s));
  if (!valid) throw new DocumentError('invalid', `${JSON.stringify(path)} is not a valid ${kind} name`);
  if (kind === 'file' && !path.endsWith('.md')) throw new DocumentError('invalid', `${path} is not a markdown file`);
  ```
- **Raised by:** structural-analyst S-3, behavioral-analyst B-3.
- **Confidence:** Verified.
- **Bears on:** D-1.

### C-4: Today, names holding troublesome characters are created as typed

- **Claim:** Typed into New file, `a?b`, `<>:`, `foo.`, and `tab<TAB>here` are all created as typed, with `.md`
  appended. `.hidden` is refused by the server with `".hidden.md" is not a valid file name`, shown in the dialog. `a/b`
  cannot be submitted.
- **Location:** traced across `file-tree.tsx`, `documents.tsx` `createEntry`, and `documents.ts` `checkPath`.
- **Evidence:** behavioral-analyst B-2's per-input trace, which follows the code in C-1 to C-3.
- **Raised by:** behavioral-analyst B-2.
- **Confidence:** Verified by reading the code. Nothing was run.
- **Bears on:** S-1, D-2, D-4.

### C-5: A new file's heading is its name without `.md`

- **Claim:** `createEntry` writes `# {name}` as the file's first line, using the path's base name without `.md`. Any
  change to the name the server receives changes the heading.
- **Location:** `src/server/documents/documents.ts`, `createEntry`.
- **Evidence:**
  ```ts
  else await writeFile(item.full, `# ${basename(path, '.md')}\n`);
  ```
- **Raised by:** behavioral-analyst B-4.
- **Confidence:** Verified.
- **Bears on:** S-1.

### C-6: The browser opens a new file by the exact path it sent

- **Claim:** `createEntry` in `documents.tsx` posts the path, refreshes the list, and opens the same path. The server
  returns `{ ok: true }` and no path. If the server rewrote a name, the browser would open a path that does not exist.
- **Location:** `src/ui/documents/documents/documents.tsx`, `createEntry`; `src/server/documents/documents.routes.ts`,
  `POST /api/documents/create`.
- **Evidence:**
  ```tsx
  await api('POST', '/api/documents/create', { path, kind });
  await refreshList();
  if (kind === 'file') await open(path);
  ```
- **Raised by:** structural-analyst S-4, confirmed by the orchestrator.
- **Confidence:** Verified.
- **Bears on:** D-1.

### C-7: Tests pin appending `.md`, the empty-name block, and the `/` block

- **Claim:** `file-tree.test.tsx` pins New file `garden` becoming `garden.md` with `# garden`, and `compost` in a folder
  becoming `drafts/compost.md`. The test "the name dialog will not submit an empty name, or one holding a /" pins
  disabling for `'  '` and for `/` through the New file dialog. UI tests use `fake-documents-api.ts`, not the real
  `checkPath`.
- **Location:** `src/ui/documents/file-tree/file-tree.test.tsx`, the tests at lines 94, 160, and 173.
- **Evidence:**
  ```tsx
  test('the name dialog will not submit an empty name, or one holding a /', async () => {
    await renderTree();
    await click('New file or folder');
    await choose('New file');
  ```
- **Raised by:** behavioral-analyst B-7, confirmed by the orchestrator.
- **Confidence:** Verified.
- **Bears on:** S-3, Unit 2.

## Findings No Agent Could Audit

Every evidence class in the area was covered. The behavioral analyst could not read the `api` helper. The orchestrator
read it (`src/ui/components/api.ts`): it shows the server's `error` sentence, or else the body text.
