// The textblocks of a ProseMirror document, shared by the server's Highlight tool and the editor's
// highlights so both split a post into the same blocks. No imports, so both sides can load it: any
// ProseMirror Node fits TextblockTree.

export interface TextblockTree {
  isTextblock: boolean;
  textContent: string;
  descendants(visit: (node: TextblockTree, pos: number) => void | boolean): void;
}

// Each textblock's text and the position where its content starts (just inside the block), in document order.
export function textblocks(root: TextblockTree): { text: string; pos: number }[] {
  const blocks: { text: string; pos: number }[] = [];
  root.descendants((node, pos) => {
    if (node.isTextblock) blocks.push({ text: node.textContent, pos: pos + 1 });
  });
  return blocks;
}
