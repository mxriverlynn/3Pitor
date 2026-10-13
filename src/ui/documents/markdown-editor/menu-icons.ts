// Icons beside the items in the editor's Insert and Text menus.
import { DropdownSubmenu, MenuItem } from 'prosemirror-menu';
import type { EditorView } from 'prosemirror-view';

// A heading's H, narrow enough to leave room for its level beside it.
const H = 'M1.5 3.5v9 M7 3.5v9 M1.5 8h5.5';

// The outline drawn for each menu item, on a 16-unit grid.
const ICON_PATHS = {
  image: 'M2 3.5h12v9h-12z M2 11l3.5-3.5 3 3 2-2 3.5 3.5 M11.5 6.5a1 1 0 1 0-2 0 1 1 0 0 0 2 0z',
  rule: 'M1.5 8h13 M4 4.5h8 M4 11.5h8',
  paragraph: 'M7.5 13.5v-11h5 M10.5 2.5v11 M7.5 8.5a3 3 0 0 1 0-6',
  'code-block': 'M5 4.5l-3.5 3.5 3.5 3.5 M11 4.5l3.5 3.5-3.5 3.5 M9.5 2.5l-3 11',
  heading: 'M3 2.5v11 M11 2.5v11 M3 8h8',
  'heading-1': `${H} M10.5 7l2-1.5v7`,
  'heading-2': `${H} M10 7a2 1.7 0 1 1 3.4 1.3L10 12.5h4`,
  'heading-3': `${H} M10 5.5h4l-2 2.7a2.1 2.1 0 1 1-2 3`,
  'heading-4': `${H} M13 12.5v-7L10 10.5h4.5`,
  'heading-5': `${H} M14 5.5h-3.4l-.5 3a2.2 2.2 0 1 1-.4 3.4`,
  'heading-6': `${H} M13.5 5.5c-2 .4-3.5 2-3.5 4.5a2 2 0 1 0 2-2c-1 0-1.7.5-2 1.2`,
};
export type Icon = keyof typeof ICON_PATHS;

// The icon's svg. Decorative: the item's label says what it does.
function iconElement(doc: Document, icon: Icon): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'menu-icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = svg.appendChild(doc.createElementNS('http://www.w3.org/2000/svg', 'path'));
  path.setAttribute('d', ICON_PATHS[icon]);
  return svg;
}

// `item` drawn as its icon followed by its label.
export function withIcon(item: MenuItem, icon: Icon): MenuItem {
  return new MenuItem({
    ...item.spec,
    render: (view) => {
      const doc = view.dom.ownerDocument;
      const button = doc.createElement('button');
      button.type = 'button';
      button.append(iconElement(doc, icon), item.spec.label ?? '');
      return button;
    },
  });
}

// A submenu whose label shows `icon` before it.
export class IconSubmenu extends DropdownSubmenu {
  constructor(
    content: ConstructorParameters<typeof DropdownSubmenu>[0],
    options: ConstructorParameters<typeof DropdownSubmenu>[1],
    private readonly icon: Icon,
  ) {
    super(content, options);
  }

  render(view: EditorView) {
    const rendered = super.render(view);
    rendered.dom.querySelector('.ProseMirror-menu-submenu-label')?.prepend(iconElement(view.dom.ownerDocument, this.icon));
    return rendered;
  }
}
