// Keyboard shortcut hints as the writer's platform shows them: "Mod" is ⌘ on a Mac and Ctrl everywhere else.
export const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

// shortcut('S') is '⌘S' on a Mac and 'Ctrl+S' elsewhere.
export function shortcut(key: string, mac = isMac): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}

// The same shortcut as aria-keyshortcuts names it.
export function keyShortcut(key: string, mac = isMac): string {
  return `${mac ? 'Meta' : 'Control'}+${key}`;
}
