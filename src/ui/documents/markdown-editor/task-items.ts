// Task list checkboxes in the editor. Ticking a box sets its task_item's `checked` attribute through an
// ordinary transaction, so ySyncPlugin writes it to the Yjs document and Save writes it out as "[x]".
import type { Node } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import type { EditorView, NodeView } from 'prosemirror-view';
import { schema } from '../../../shared/markdown';

const taskItem = schema.nodes.task_item;

// A task list item: the checkbox, then the item's content. The box is not editable text, so ProseMirror
// leaves its events and DOM changes alone.
export function taskItemView(node: Node, view: EditorView, getPos: () => number | undefined): NodeView {
  const dom = document.createElement('li');
  dom.className = 'task-item';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.contentEditable = 'false';
  box.setAttribute('aria-label', 'Done');
  const contentDOM = document.createElement('div');
  contentDOM.className = 'task-item-body';
  dom.append(box, contentDOM);
  const show = (item: Node) => {
    box.checked = item.attrs.checked;
    dom.dataset.task = item.attrs.checked ? 'done' : 'todo';
  };
  show(node);
  box.addEventListener('click', (event) => {
    const pos = getPos();
    // A read-only document keeps its boxes as they are.
    if (!view.editable || pos === undefined) {
      event.preventDefault();
      return;
    }
    const item = view.state.doc.nodeAt(pos)!;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...item.attrs, checked: box.checked }));
  });
  return {
    dom,
    contentDOM,
    update: (next) => {
      if (next.type !== taskItem) return false;
      show(next);
      return true;
    },
    stopEvent: (event) => event.target === box,
    ignoreMutation: (mutation) => mutation.target === box,
  };
}

// Enter in a task starts a new, unticked task; Tab-style nesting and lifting work as in other lists. Goes
// before the example setup's keymap, whose list commands handle only plain list items.
export const taskItemKeymap = keymap({
  Enter: splitListItem(taskItem, { checked: false }),
  'Mod-[': liftListItem(taskItem),
  'Mod-]': sinkListItem(taskItem),
});
