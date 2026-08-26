/** A block tree node — only identity and shape matter here. */
interface BlockLike {
  id: string;
  children: BlockLike[];
}

/** Depth-first block ids of a document, in visual order. */
export function flattenBlockIds(blocks: BlockLike[]): string[] {
  return blocks.flatMap((block) => [block.id, ...flattenBlockIds(block.children)]);
}

/**
 * Where the caret should land after a document rewrite: the cursor's own
 * block when it survived, otherwise the nearest surviving block before it
 * (falling forward only when everything before it is gone). Undo often
 * removes the exact block the caret sat in — without a fallback the editor
 * dropped focus entirely and the user had to click back in.
 */
export function caretTargetAfterRewrite(
  oldOrder: string[],
  cursorId: string,
  exists: (id: string) => boolean
): string | undefined {
  const at = oldOrder.indexOf(cursorId);
  if (at === -1) return undefined;
  for (let i = at; i >= 0; i--) {
    const id = oldOrder[i];
    if (id !== undefined && exists(id)) return id;
  }
  for (let i = at + 1; i < oldOrder.length; i++) {
    const id = oldOrder[i];
    if (id !== undefined && exists(id)) return id;
  }
  return undefined;
}
