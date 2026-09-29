# Evidence Rule (Evidence-Based)

## Contents

- Trust classes
- The three principles
- How to apply the rule
- Escalation
- What this rule is not

This rule defines what evidence means in the research skill, how to characterize how strong it is, and what to do when
no evidence exists at all. It answers _how confident should you be in the evidence, and what is the response when no
evidence is available?_

## Trust classes

Every artifact the research cites carries one of two trust classes:

- **Web** sits outside the trust boundary. Documentation, blog posts, Stack Overflow, GitHub issues, RFCs, vendor
  whitepapers, LLM-generated content. Web sources can be wrong, stale, adversarially shaped, or contextually misapplied.
- **Provided** is material the writer supplied: text pasted into the chat, links handed to the skill, and workspace
  files the writer pointed at. Apply interested-party scrutiny; hold to the same standard as web sources.

## The three principles

### Principle 1: Proximity to origin (heuristic, not ranked tier list)

Evidence drawn from closer to the originating event or data carries more weight than evidence at greater remove. Apply
this as a heuristic, not as a ranked tier list. A numbered ordering of source types looks operational but breaks at the
first tier boundary.

The principle inverts in two contexts: formal-methods or specification-compliance contexts (the specification is the
authoritative artifact), and regulatory or contractual contexts (the regulation wins).

### Principle 2: Independent corroboration

A claim corroborated by two or more independent sources carries more weight than a claim resting on one. Applied as a
gate:

**A claim that bears on a recommendation and has no independent corroboration is marked single-source and cannot be the
sole basis for the recommendation.**

When sources contradict each other, surface the conflict. Record both, name the disagreement, and let the reader judge.

### Principle 3: Explicit no-evidence labeling

When a claim has no evidence at all, label it. Defer the dependent decision. Name the concrete trigger that would justify
revisiting: a measured metric, an incident class, a commitment, a regulation taking effect, a dependency landing.
Aspirational triggers do not qualify.

Do not collapse "no evidence" into "very weak evidence." They are different states.

## How to apply the rule

### When producing the research

For every claim that drives a conclusion:

1. Name the trust class (web or provided).
2. For claims that bear on the recommendation, apply the corroboration gate. Single-source claims get marked and cannot
   stand alone.
3. For claims with no evidence at all, label the claim, defer the dependent decision, and record the reopen trigger.

### When validating the research

For every committed claim in the report:

1. Check that the trust class is named or inferable.
2. Check that single-source claims are marked and do not stand alone as the basis for a recommendation.
3. Check that no-evidence claims are labeled and deferred with a trigger, not silently treated as weak evidence.
4. Surface contradictions between sources rather than picking the agreeable one.

## Escalation

Claims that fail the corroboration gate and cannot be corroborated are **never silently accepted**. They surface to the
writer with the single-source label so the choice to act on them is conscious. The writer always wins; they may direct a
single-source claim to be acted on against the gate, and the override is recorded with rationale so the choice stays
visible.

## What this rule is not

- **Not a ranked tier list.** The proximity-to-origin principle is a heuristic. A numbered ordering of source types will
  produce inconsistent results from run to run.
- **Not a bar for academic rigor.** The bar is operational. "You can tell where this came from and how strongly it
  rests" is the standard.
