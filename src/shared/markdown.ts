// The editor's markdown dialect, shared by the UI and the server so both read a post the same way:
// CommonMark plus task lists ("- [ ] sow the beans", "- [x] till the bed"). A task list is a node type
// of its own, task_list, and each of its checkboxes a task_item whose `checked` attribute holds the
// box's state; the Yjs document stores them as elements of those names, carrying that attribute, so a
// tick survives merges and is written back out as "[x]" or "[ ]" on Save.
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import { Schema, type Node } from 'prosemirror-model';
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
  MarkdownSerializer,
  schema as commonmark,
} from 'prosemirror-markdown';

export const schema = new Schema({
  nodes: commonmark.spec.nodes.append({
    // A bullet list with at least one checkbox. Its other items stay plain list_items, without a box.
    task_list: {
      content: '(task_item | list_item)+',
      group: 'block',
      attrs: { tight: { default: false } },
      parseDOM: [{ tag: 'ul[data-task-list]', priority: 60, getAttrs: (dom) => ({ tight: dom.hasAttribute('data-tight') }) }],
      toDOM: (node) => ['ul', { 'data-task-list': '', class: 'task-list', 'data-tight': node.attrs.tight ? 'true' : null }, 0],
    },
    task_item: {
      content: 'block+',
      defining: true,
      attrs: { checked: { default: false } },
      parseDOM: [{ tag: 'li[data-task]', priority: 60, getAttrs: (dom) => ({ checked: dom.getAttribute('data-task') === 'done' }) }],
      toDOM: (node) => [
        'li',
        { 'data-task': node.attrs.checked ? 'done' : 'todo', class: 'task-item' },
        ['input', { type: 'checkbox', contenteditable: 'false', ...(node.attrs.checked ? { checked: '' } : {}) }],
        ['div', { class: 'task-item-body' }, 0],
      ],
    },
  }),
  marks: commonmark.spec.marks,
});

// A task's box at the start of a list item's first line: "[ ]", "[x]", or "[X]", then a space or the line's end.
const BOX = /^\[([ xX])\](?:[ \t]+|(?=\n)|$)/;

// Turns bullet list items that start with a box into task_item tokens, and their lists into task_list
// tokens. Runs after inline parsing, so it drops the box from both the item's text and its inline tokens.
function taskLists(state: StateCore) {
  const tokens = state.tokens;
  // The index of the token closing the one opened at `open`: the next of `type` at the same level.
  const closing = (open: number, type: string) => {
    for (let i = open + 1; i < tokens.length; i++) if (tokens[i].type === type && tokens[i].level === tokens[open].level) return i;
    return -1;
  };
  tokens.forEach((list, l) => {
    if (list.type !== 'bullet_list_open') return;
    const end = closing(l, 'bullet_list_close');
    let tasks = 0;
    for (let i = l + 1; i < end; i++) {
      const item = tokens[i];
      if (item.type !== 'list_item_open' || item.level !== list.level + 1) continue;
      const inline = tokens[i + 2];
      const box = tokens[i + 1].type === 'paragraph_open' && inline?.type === 'inline' ? BOX.exec(inline.content) : null;
      if (!box) continue;
      tasks++;
      item.type = 'task_item_open';
      item.meta = { checked: box[1] !== ' ' };
      tokens[closing(i, 'list_item_close')].type = 'task_item_close';
      inline.content = inline.content.slice(box[0].length);
      dropBox(inline.children ?? [], box[0].length);
    }
    if (!tasks) return;
    list.type = 'task_list_open';
    tokens[end].type = 'task_list_close';
  });
}

// Removes the first `length` characters, the box, from the start of an item's inline tokens.
function dropBox(children: Token[], length: number) {
  while (length > 0 && children[0]?.type === 'text') {
    const text = children[0];
    const cut = Math.min(length, text.content.length);
    text.content = text.content.slice(cut);
    length -= cut;
    if (!text.content) children.shift();
  }
  // A box alone on its line leaves the line break after it.
  if (children[0]?.type === 'softbreak') children.shift();
}

// Whether the list opening at `i` is tight: its first item's paragraphs are hidden.
function listIsTight(tokens: Token[], i: number): boolean {
  while (++i < tokens.length) if (tokens[i].type !== 'list_item_open' && tokens[i].type !== 'task_item_open') return tokens[i].hidden;
  return false;
}

const tokenizer = MarkdownIt('commonmark', { html: false });
tokenizer.core.ruler.push('task_lists', taskLists);

export const markdownParser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  bullet_list: { block: 'bullet_list', getAttrs: (_, tokens, i) => ({ tight: listIsTight(tokens, i) }) },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (tok, tokens, i) => ({ order: +(tok.attrGet('start') ?? 1) || 1, tight: listIsTight(tokens, i) }),
  },
  task_list: { block: 'task_list', getAttrs: (_, tokens, i) => ({ tight: listIsTight(tokens, i) }) },
  task_item: { block: 'task_item', getAttrs: (tok) => ({ checked: tok.meta?.checked === true }) },
});

// The default serializer, but writing "-" bullets instead of "*", and each task's box before its text.
export const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    bullet_list(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
    task_list(state, node) {
      state.renderList(node, '  ', (i) => {
        const item = node.child(i);
        if (item.type.name !== 'task_item') return '- ';
        return item.attrs.checked ? '- [x] ' : '- [ ] ';
      });
    },
    task_item(state, node) {
      state.renderContent(node);
    },
  },
  defaultMarkdownSerializer.marks,
);

export function parseMarkdown(markdown: string): Node {
  return markdownParser.parse(markdown);
}
