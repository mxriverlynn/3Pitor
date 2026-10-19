# Decision Log

The user's standing instruction for planning runs in this repository is "make the best decisions you can, without
asking me". Under it, this run settled both human gates itself. Each decision below cites what it rests on.

| ID | Decision | Rests on |
| --- | --- | --- |
| D1 | Option A: extend `PostStore` with flat, post-id-first methods. Options B (sibling interface) and C (per-post handle) are rejected. | F20: research writes must share the post's queue and tombstones to be ordered against `delete`. Option A meets that by construction and follows F10, F17, F18, and F19. |
| D2 | A research document's identity is the pair (post id, research document id). Any stored reference holds both. No `postId` field on the summary. | Q1. Every call already takes the post id; a field would be unused today. |
| D3 | Research documents are never shared between posts (O1). | F11, F27: the existing delete promise. Sharing needs a link table and an orphan policy the goal does not ask for. |
| D4 | Research documents carry a stored, never-blank title (O2). | Q2, F13: the same title rule as posts, so a list of opaque ids has a label to pick from. |
| D5 | "No outline" (`null`) is distinct from an empty outline (`""`) (O3). | Q2, F29: bodies round-trip `""`, and G2 makes absence a real state. |
| D6 | `PostError.subject` is required, with no default. | Q5, F32: with a default, a research path that forgets the subject compiles and tells the writer "That post no longer exists." |
| D7 | Research documents can be edited in place with `setResearchDocumentBody` and `setResearchDocumentTitle`. Reinstated from the cut list. | Q7: delete plus create changes the id (breaking D2's references) and is not atomic. This matches posts and the outline, which are both editable. Per V2, this goes beyond the goal's word "associate" and is flagged to the user. |
| D8 | Names use the goal's own words, "research document": `ResearchDocumentId`, `ResearchDocument`, `ResearchDocumentSummary`, `ResearchDocumentList { researchDocuments }`, and `…ResearchDocument…` methods. The error subject is `'research-document'`. | Q8: "research" is a mass noun, and `{ research }` breaks the plural-field pattern of `PostList { posts }`. |
| D9 | A blank title is checked before any I/O, so it is `'invalid'` even when the post is missing. Otherwise a missing post's `'not-found'` wins over a missing research document's. | Q10. Same rule as the earlier design's `create` (`docs/changes/post-management-api/api-design.md:357`). |
| D10 | A research document the store never titled, such as one made by another writer, gets a never-blank title the store derives. Whether other writers' documents appear follows the same "if the implementation can see it" rule as posts. | Q12. Mirrors `PostSummary`'s fallback title (`src/posts/posts.ts:31-32`). |
| D11 | This is the method set for this direction. Removing one later breaks every implementor once a second store exists, so integration planning confirms the set before a database store is built. | Q15, G6, G7, V2. |
