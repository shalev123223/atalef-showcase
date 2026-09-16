# 004 — Ranking strategies are permutations, not weighted scores

**Status:** Accepted, implemented

## Context

Among the candidates eligible for a position, the engine ranks by six factors, compared in
order (lexicographically):

1. `MATCH_QUALITY` — primary or secondary role and site, or substitution
2. `HITCH` — continuing a two-week block on the same site
3. `FAIRNESS` — period balance, then historical balance
4. `REST_QUALITY` — rested at least the preferred amount
5. `CONTINUITY` — same site or region as last week
6. `SENIORITY` — hire date

Managers asked to be able to change what matters most.

## Decision

A **strategy is a permutation of these six factors**. Five presets ship (`BALANCED`,
`FAIRNESS_FIRST`, `CONTINUITY_FIRST`, `REST_FIRST`, `EXPERTISE_FIRST`), plus a
manager-defined `CUSTOM` order.

- `BALANCED` is identical to the original default order, so nothing changes until a manager
  acts. A test enforces this.
- A custom order is always normalized into a *complete* permutation. Otherwise any factor left
  out would silently drop to the arbitrary ID tie-break.
- A strategy changes *who* is picked among people who are already eligible. It never relaxes a
  rule.

## Why not weights

Weighted scoring was considered and rejected:

- **The factors can't be measured on one scale.** One is an ordinal tier, one is a boolean,
  one is a number of weeks and one is a date. Weights would need invented scales, tuned by
  guesswork.
- **Weights destroy explainability.** "Score 0.734 vs 0.729" is not a reason a manager can act
  on, and the override and audit screens depend on being able to explain a decision.
- **Floating-point ties break determinism.**

If finer control is ever needed, the answer is a new *comparator* in the same place: a few
lines, and still fully explainable.

## Consequences

- Every run stores its strategy and the exact order used. This matters because the meaning of a
  `CUSTOM` run would otherwise change the next time the manager edits the list.
- The manual picker ranks with the same saved order and shows which one it used.
- The planning simulator is deliberately pinned to the default order. It answers "do we have
  enough people?", and eligibility doesn't depend on ranking.
