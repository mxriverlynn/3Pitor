# Question Round

`han-core:junior-developer` questioned Option A. Each question is sorted into one bucket: settled by the goal, settled
by the context brief, or open and decided under the user's delegation (see [decision-log.md](./decision-log.md)).

| Q | Question | Bucket | Answer |
| --- | --- | --- | --- |
| Q1 | Is a research id meaningful alone, or is the identity the pair? | Open | D2: the pair. |
| Q2 | Are O1–O3 decided or still open? | Open | D3, D4, D5. |
| Q3 | Does a `setOutline` that changes nothing send a watch signal? | Brief (F15) | It may signal; spurious signals are already allowed (`src/posts/posts.ts:90-91`). The suite asserts nothing about it. |
| Q4 | What are the exact research error messages, and which texts change? | Brief (F12, F32) | "That research document no longer exists." and "A research document needs a title." The `post-error.ts` comments, the suite's message table, and the earlier design's I10 change. |
| Q5 | Why does `subject` default to `'post'`? | Open | D6: it is required. |
| Q6 | How does an HTTP client tell "post gone" from "document gone"? | Goal (G7) | Integration. Recorded as an open risk. |
| Q7 | Is "no editing research" acceptable when the outline is editable? | Open | D7: editing reinstated. |
| Q8 | What do `Research` and `ResearchList.research` hold? | Open | D8: renamed to "research document". |
| Q9 | What can callers sort research by? | Brief (F30) | Title only, deliberately; a timestamp is additive later. |
| Q10 | Missing post plus blank title on create: which error wins? | Open | D9: `'invalid'`, checked before I/O. |
| Q11 | Is `listResearchDocuments` ordered with the post's other calls, and can it reject? | Brief (F14) | Yes to both, unlike `list()`; its comment says so on purpose. |
| Q12 | Do research documents from other writers appear, and what is their title? | Open | D10: a derived, never-blank title. |
| Q13 | Why does `outline.md` become visible while `research.md` stays hidden? | Goal (G7), brief (F34) | Accepted for the file-store mapping. BC3 is amended explicitly. |
| Q14 | How much must a caller re-read after a signal? | Brief (F15) | Signals stay detail-free. Recorded as an open risk. |
| Q15 | Who is the first consumer, and does the method set match it? | Goal (G6, G7) | Direction only. Delete and `setOutline(null)` descend from G2. D11. |
