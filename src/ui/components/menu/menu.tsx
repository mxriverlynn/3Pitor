// A menu of actions that opens from a button, with an icon beside each item.
import { useEffect, useRef } from 'react';
import './menu.css';

// The outline drawn for each menu action, on a 16-unit grid.
const ACTION_PATHS = {
  'new-file': 'M4 1.5h5l3.5 3.5v3.5 M9 1.5v3.5h3.5 M4 1.5v13h4 M11.5 10v5 M9 12.5h5',
  'new-folder': 'M1.5 3.5h4.5l1.5 1.5h7v3 M1.5 3.5v10h6 M11.5 10v5 M9 12.5h5',
  rename: 'M10.5 2.5l3 3-8 8h-3v-3z M9 4l3 3',
  move: 'M1.5 8h9 M7.5 5l3 3-3 3 M13.5 2.5v11',
  delete: 'M2.5 4.5h11 M6 4.5v-2h4v2 M4 4.5l.7 9h6.6l.7-9 M6.8 7v4.5 M9.2 7v4.5',
  collaborate: 'M5.5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M1.5 13.5c0-2.2 1.8-4 4-4s4 1.8 4 4 M10.5 3.2a2 2 0 1 1 0 3.6 M11.5 9.6c1.8.4 3 1.9 3 3.9',
  proofread: 'M1.5 11l3-8.5 3 8.5 M2.6 8h3.8 M8.5 11.5l2.2 2.5 4-5.5',
  research: 'M6.5 11a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z M9.8 9.8l4.2 4.2',
};
type Action = keyof typeof ACTION_PATHS;

// The icon beside a menu item. Decorative: the item's label says what it does.
const ActionIcon = ({ action }: { action: Action }) => (
  <svg className={`icon ${action}`} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d={ACTION_PATHS[action]} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// A menu item: its label, its icon, and what choosing it does.
export type Item = { label: string; icon: Action; run: () => void };

// A positioned menu of `items`. It closes on Escape, and on a press anywhere outside it and the button that opened it.
export function Menu({ items, opener, onClose }: { items: Item[]; opener: HTMLElement; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !opener.contains(target)) onClose();
    };
    document.addEventListener('pointerdown', onPress);
    return () => document.removeEventListener('pointerdown', onPress);
  }, [opener, onClose]);
  useEffect(() => menu.current?.querySelector('button')?.focus(), []);
  return (
    <div className="menu" role="menu" ref={menu} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      {items.map(({ label, icon, run }) => (
        <button
          key={label}
          role="menuitem"
          onClick={() => {
            onClose();
            run();
          }}
        >
          <ActionIcon action={icon} />
          {label}
        </button>
      ))}
    </div>
  );
}
