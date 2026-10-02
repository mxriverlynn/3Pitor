# Lists every relative import under src/ui that leaves one feature folder for another feature folder.
# Root files such as app.tsx sit in no feature, and ui/components/ is shared scope, so neither counts.
import os, re, sys
ui = 'src/ui'
features = {d for d in os.listdir(ui) if os.path.isdir(os.path.join(ui, d)) and d != 'components'}
found = 0
for root, _, files in os.walk(ui):
    for name in files:
        if not name.endswith(('.ts', '.tsx')): continue
        path = os.path.join(root, name)
        rel = os.path.relpath(path, ui).split(os.sep)
        if len(rel) < 2 or rel[0] not in features: continue
        for n, line in enumerate(open(path), 1):
            for spec in re.findall(r"""(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]""", line):
                target = os.path.relpath(os.path.normpath(os.path.join(root, spec)), ui).split(os.sep)[0]
                if target in features and target != rel[0]:
                    print(f'{path}:{n} -> {spec}'); found += 1
sys.exit(1 if found else 0)
