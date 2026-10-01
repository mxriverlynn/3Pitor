// The outline around the highlighted passage the writer is on, which the editor draws as one shape over however many
// pieces the passage is split into. Boxes here are measured on screen; nothing here knows about the editor.
export type Box = { left: number; top: number; right: number; bottom: number };

// How far outside the text the outline's stroke is centered. Paired with `stroke-width: 2` in markdown-editor.css,
// it covers 1px to 3px outside the text, as today's `outline: 2px; outline-offset: 1px` does.
export const OUTLINE_PAD = 2;

// One box per line the boxes sit on, top to bottom. Boxes with no width are dropped. The rest are taken in order of
// their top; each joins the line before it when its vertical middle lies within that line's top and bottom so far,
// and the line grows to cover it. Otherwise it starts a new line.
export function lineBoxes(boxes: readonly Box[]): Box[] {
  const lines: Box[] = [];
  for (const b of boxes.filter((b) => b.right > b.left).sort((a, b) => a.top - b.top)) {
    const line = lines.at(-1);
    const middle = (b.top + b.bottom) / 2;
    if (line && middle >= line.top && middle <= line.bottom) {
      lines[lines.length - 1] = {
        left: Math.min(line.left, b.left),
        top: Math.min(line.top, b.top),
        right: Math.max(line.right, b.right),
        bottom: Math.max(line.bottom, b.bottom),
      };
    } else lines.push({ ...b });
  }
  return lines;
}

// An SVG path tracing the outline around `lines`, each grown by OUTLINE_PAD on every side. Consecutive lines that
// overlap horizontally share one closed shape, meeting halfway between them; lines that do not overlap get separate
// shapes. Empty input gives ''.
export function outlinePath(lines: readonly Box[]): string {
  const shapes: Box[][] = [];
  for (const line of lines) {
    const shape = shapes.at(-1);
    const above = shape?.at(-1);
    if (shape && above && line.left < above.right && above.left < line.right) shape.push(line);
    else shapes.push([line]);
  }
  return shapes.map(trace).join(' ');
}

// One closed shape around `lines`: across the top line, down the right side line by line, across the bottom line, and
// back up the left side.
function trace(lines: Box[]): string {
  const b = lines.map((l) => ({ left: l.left - OUTLINE_PAD, top: l.top - OUTLINE_PAD, right: l.right + OUTLINE_PAD, bottom: l.bottom + OUTLINE_PAD }));
  const mid = (i: number) => (b[i]!.bottom + b[i + 1]!.top) / 2;
  const last = b.at(-1)!;
  let path = `M${b[0]!.left} ${b[0]!.top} H${b[0]!.right}`;
  for (let i = 0; i + 1 < b.length; i++) path += ` V${mid(i)} H${b[i + 1]!.right}`;
  path += ` V${last.bottom} H${last.left}`;
  for (let i = b.length - 2; i >= 0; i--) path += ` V${mid(i)} H${b[i]!.left}`;
  return `${path} Z`;
}
