# Checks the import and boundary rules of the cli / server / engine split (api-design.md, A64 and done-when 6).
# Run from the repository root: python3 docs/changes/server-engine-split/artifacts/check_boundaries.py
# Prints each violation as path:line and the rule it breaks, and exits 1 if there are any.
import os, re, sys

problems = []


def report(path, n, rule, text):
    problems.append(f'{path}:{n}  [{rule}] {text.strip()}')


def files(root, test=None):
    for folder, _, names in os.walk(root):
        for name in names:
            if not name.endswith(('.ts', '.tsx')): continue
            is_test = name.endswith(('.test.ts', '.test.tsx'))
            if test is not None and is_test != test: continue
            yield os.path.join(folder, name)


IMPORT = re.compile(r"""(?:from|import)\s*\(?\s*['"]([^'"]+)['"]""")


def imports(path):
    for n, line in enumerate(open(path), 1):
        for spec in IMPORT.findall(line):
            yield n, line, spec


def target(path, spec):
    # The src-relative module an import names, or the bare package name.
    if not spec.startswith('.'): return spec
    return os.path.relpath(os.path.normpath(os.path.join(os.path.dirname(path), spec)), 'src')


def package(module):
    return module.split(os.sep)[0] if not module.startswith(('.', '@')) and os.sep in module else None


# E1 + A60: the engine knows nothing of HTTP, WebSockets, or the packages above it.
A60 = [
    (r'\b(Request|Response)\b', 'Request/Response'),
    (r'createUIMessageStreamResponse', 'SSE response'),
    (r'upgradeWebSocket', 'WebSocket upgrade'),
    (r'\bWebSocket\b', 'WebSocket'),
    (r"""type: ['"]http['"]""", 'HTTP transport detail'),
    (r'Bun\.serve\b', 'Bun.serve'),
]
for path in files('src/engine'):
    for n, line in enumerate(open(path), 1):
        if re.search(r"""from ['"](\.\./)+(server|cli|ui)/""", line): report(path, n, 'E1', line)
        if re.search(r"""from ['"]hono""", line): report(path, n, 'E1', line)
        for pattern, name in A60:
            if re.search(pattern, line): report(path, n, f'A60 {name}', line)
        if re.search(r'\bfetch\(', line) and path != 'src/engine/chat/components/fake-claude.ts':
            report(path, n, 'A60 fetch', line)
    # E2: engine production code imports only engine, shared, the file-system entry, and npm modules.
    if not path.endswith('.test.ts'):
        for n, line, spec in imports(path):
            module = target(path, spec)
            if spec.startswith('.') and package(module) not in ('engine', 'shared') and module != 'file-system/file-system':
                report(path, n, 'E2', line)

# S3: what server tests and check.ts may take from the engine besides engine.ts.
S3 = {
    'engine/engine': None,
    'engine/paths': {'SRC'},
    'engine/components/json-file': {'stateKey'},
    'engine/chat/tools/tools': {'fileTools', 'turnTexts', 'editedTexts'},
    'engine/chat/claude-cli/claude-cli': {'claudeCliModel'},
    'engine/chat/components/fake-claude-on-path': {'fakeClaudeOnPath'},
    'engine/chat/components/chat-test-helpers': None,
}
for path in files('src/server'):
    production = not path.endswith('.test.ts') and '/scripts/' not in path
    text = open(path).read()
    for n, line, spec in imports(path):
        module = target(path, spec)
        if package(module) == 'cli': report(path, n, 'S2', line)
        # FS3: server production code never touches the file system package; its tests and scripts use only the entry.
        if package(module) == 'file-system':
            if production or module != 'file-system/file-system': report(path, n, 'FS3', line)
            continue
        if module == 'ui/index.html' and path != 'src/server/server.ts': report(path, n, 'S4', line)
        if package(module) != 'engine': continue
        if production:
            if module != 'engine/engine': report(path, n, 'S1', line)
        elif module not in S3:
            report(path, n, 'S3', line)
        elif S3[module] is not None:
            names = re.search(r'\{([^}]*)\}', line)
            for name in (names.group(1).split(',') if names else ['*']):
                name = name.strip().removeprefix('type ').split(' as ')[0].strip()
                if name and name not in S3[module]: report(path, n, f'S3 {name}', line)
    if production and 'createEngine(' in text: report(path, 0, 'A65', 'createEngine( in production code')
    if production and 'process.env' in text: report(path, 0, 'Env', 'process.env in server production code')

for path in files('src/cli'):
    text = open(path).read()
    for n, line, spec in imports(path):
        module = target(path, spec)
        if path.endswith('.test.ts'):
            # C2: cli tests spawn cli.ts and import only ./command-line, bun:test, and node:*.
            if spec != './command-line' and spec != 'bun:test' and not spec.startswith('node:'): report(path, n, 'C2', line)
        elif package(module) == 'engine' and module != 'engine/engine': report(path, n, 'C1', line)
        elif package(module) == 'server' and module != 'server/server': report(path, n, 'C1', line)
        elif package(module) == 'file-system' and module != 'file-system/file-system': report(path, n, 'C1', line)
        elif package(module) == 'ui': report(path, n, 'C1', line)
    if re.search(r"""from ['"]hono""", text) or 'Bun.serve' in text: report(path, 0, 'C3', 'hono or Bun.serve in cli')
    if not path.endswith('.test.ts') and 'createEngine(' in text: report(path, 0, 'A65', 'createEngine( in production code')

# U1 and H1.
for path in files('src/ui'):
    for n, line, spec in imports(path):
        if package(target(path, spec)) in ('server', 'engine', 'cli', 'file-system'): report(path, n, 'U1', line)
for path in files('src/shared'):
    for n, line, spec in imports(path):
        if spec.startswith('.') and package(target(path, spec)) != 'shared': report(path, n, 'H1', line)

# FS2: the file-system package imports no other package.
for path in files('src/file-system'):
    for n, line, spec in imports(path):
        if spec.startswith('.') and package(target(path, spec)) != 'file-system': report(path, n, 'FS2', line)

# A35: paths.ts and its test no longer name src/server.
for path in ('src/engine/paths.ts', 'src/engine/paths.test.ts'):
    for n, line in enumerate(open(path), 1):
        if 'src/server' in line: report(path, n, 'A35', line)

# server.ts has no top-level await.
for n, line in enumerate(open('src/server/server.ts'), 1):
    if re.match(r'(const|let|)\s*\S*\s*=?\s*await\b', line) or line.startswith('await '): report('src/server/server.ts', n, 'no top-level await', line)

# Removed files.
for name in ('server.test.ts', 'agent-host.ts', 'command-line.ts', 'paths.ts'):
    if os.path.exists(f'src/server/{name}'): report(f'src/server/{name}', 0, 'removed', 'still exists')
for path in ('src/engine/components/workspace-path.ts', 'src/engine/workspace/workspace.ts'):
    if os.path.exists(path): report(path, 0, 'removed', 'still exists')

print('\n'.join(problems) if problems else 'all boundary rules hold')
sys.exit(1 if problems else 0)
