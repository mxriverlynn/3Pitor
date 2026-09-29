// The "/" button that opens the Agent Actions menu. Choosing an action hands its slash command to `onChoose`, which
// puts it in a text box, ready to edit or send.
import { useCallback, useState } from 'react';
import { Menu, type Item } from '../menu/menu';
import './agent-actions.css';

// Each action: its menu label, its icon, and the skill its command runs.
const ACTIONS: { label: string; icon: Item['icon']; skill: string }[] = [
  { label: 'Collaborative Editing', icon: 'collaborate', skill: 'collaborative-editing' },
  { label: 'Proofread', icon: 'proofread', skill: 'proofread' },
  { label: 'Research', icon: 'research', skill: 'research' },
];

export function AgentActions({ onChoose }: { onChoose: (command: string) => void }) {
  // The menu is open while it holds the button that opened it.
  const [opener, setOpener] = useState<HTMLElement>();
  const close = useCallback(() => setOpener(undefined), []);
  const items = ACTIONS.map(({ label, icon, skill }) => ({ label, icon, run: () => onChoose(`/${skill} `) }));
  return (
    // The Escape that closes the menu stops here, so it does not also close a popup the menu sits in.
    <div className="agent-actions" onKeyDown={(e) => opener && e.key === 'Escape' && e.stopPropagation()}>
      <button
        type="button"
        aria-label="Agent Actions"
        title="Agent Actions"
        aria-haspopup="menu"
        aria-expanded={!!opener}
        onClick={(e) => setOpener(opener ? undefined : e.currentTarget)}
      >
        /
      </button>
      {opener && <Menu items={items} opener={opener} onClose={close} />}
    </div>
  );
}
