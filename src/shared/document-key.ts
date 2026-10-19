// The one grammar for naming a document outside the post store: a post, its outline, or one of its research documents.
// The engine's tools, the browser, and the check script all name documents this way, as one string.
// - A post's key is its id, so every post id, saved view, and session from before outlines and research keeps working.
// - An outline's or research document's key is "." followed by a JSON array: ["outline", postId] or
//   ["research", postId, researchDocumentId]. No post id starts with ".", since the store never treats a hidden name
//   as a post, so the two forms never meet.
// Imports nothing, so the engine (Bun-free) and the browser bundle can both use it.

export type DocumentRef =
  | { kind: 'post'; postId: string }
  | { kind: 'outline'; postId: string }
  | { kind: 'research'; postId: string; researchDocumentId: string };

export function documentKey(ref: DocumentRef): string {
  if (ref.kind === 'post') return ref.postId;
  if (ref.kind === 'outline') return `.${JSON.stringify(['outline', ref.postId])}`;
  return `.${JSON.stringify(['research', ref.postId, ref.researchDocumentId])}`;
}

// The exact inverse of documentKey: undefined for "", and for a key starting with "." that is not one documentKey
// writes, spelled exactly as it writes it.
export function parseDocumentKey(key: string): DocumentRef | undefined {
  if (key === '') return undefined;
  if (!key.startsWith('.')) return { kind: 'post', postId: key };
  let value: unknown;
  try {
    value = JSON.parse(key.slice(1));
  } catch {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((part) => typeof part === 'string')) return undefined;
  const ref: DocumentRef | undefined =
    value[0] === 'outline' && value.length === 2
      ? { kind: 'outline', postId: value[1] }
      : value[0] === 'research' && value.length === 3
        ? { kind: 'research', postId: value[1], researchDocumentId: value[2] }
        : undefined;
  return ref && documentKey(ref) === key ? ref : undefined;
}

export const postKey = (postId: string) => documentKey({ kind: 'post', postId });
export const postOfKey = (key: string) => parseDocumentKey(key)?.postId;
