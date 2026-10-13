// Table cells in the editor. A pipe table's cell is one line, so the keys that insert a line break do
// nothing in one; left to themselves they would split the table around the break.
import type { Command } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';

// Whether the selection starts in a table cell: then the key is taken, and nothing happens.
const inCell: Command = (state) => ['table_cell', 'table_header'].includes(state.selection.$from.parent.type.name);

export const tableCellKeymap = keymap({ 'Mod-Enter': inCell, 'Shift-Enter': inCell, 'Ctrl-Enter': inCell });
