// The actions Claude offers: the Actions button's menu in the chat box, and the suggestions an empty chat shows.
// Choosing one hands its slash command to `onChoose`, which puts it in the chat box, ready to add to or send.
import { useCallback, useState } from 'react';
import { Menu, type Item } from '../../components/menu/menu';
import './actions.css';

// Each action: its label, what it does, its icon, and the skill its command runs.
export const ACTIONS: { label: string; hint: string; icon: Item['icon']; skill: string }[] = [
  { label: 'Proofread', hint: 'Fix spelling, grammar and typos', icon: 'proofread', skill: 'proofread' },
  { label: 'Edit together', hint: 'Go through the post section by section', icon: 'collaborate', skill: 'collaborative-editing' },
  { label: 'Research', hint: 'Check claims and find sources', icon: 'research', skill: 'research' },
];

// The command an action puts in the chat box.
export const command = (skill: string) => `/${skill} `;

export function ActionsMenu({ onChoose }: { onChoose: (command: string) => void }) {
  // The menu is open while it holds the button that opened it.
  const [opener, setOpener] = useState<HTMLElement>();
  const close = useCallback(() => setOpener(undefined), []);
  const items = ACTIONS.map(({ label, icon, skill }) => ({ label, icon, run: () => onChoose(command(skill)) }));
  return (
    // The Escape that closes the menu stops here, so it does not also close anything the menu sits in.
    <div className="actions-menu" onKeyDown={(e) => opener && e.key === 'Escape' && e.stopPropagation()}>
      <button type="button" className="ghost" aria-haspopup="menu" aria-expanded={!!opener} onClick={(e) => setOpener(opener ? undefined : e.currentTarget)}>
        Actions
      </button>
      {opener && <Menu items={items} opener={opener} onClose={close} />}
    </div>
  );
}

// What an empty chat shows: how Claude edits, and each action as a button to try.
export function Suggestions({ onChoose }: { onChoose: (command: string) => void }) {
  return (
    <div className="suggestions">
      <p>Claude edits right in your post. Its changes show up as unsaved, so nothing is written until you save.</p>
      <p className="try">Try</p>
      {ACTIONS.map(({ label, hint, skill }) => (
        <button key={skill} type="button" onClick={() => onChoose(command(skill))}>
          <b>{label}</b>
          <span>{hint}</span>
        </button>
      ))}
    </div>
  );
}
