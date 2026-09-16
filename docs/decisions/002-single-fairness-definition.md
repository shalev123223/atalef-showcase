# 002 — One fairness definition

**Status:** Accepted, implemented

## Context

Employees work different rotation patterns: two weeks on and two off, or two weeks on and four
off. Comparing raw week counts across them is meaningless: someone on 2/4 who worked 2 of the
last 6 weeks is exactly on target. The legacy system computed fairness three different ways.

## Decision

Fairness lives only in `src/domain/fairness/`. No other module may compute it.

```
patternRatio      = 1/2 (2-on-2-off) or 1/3 (2-on-4-off)
expectedWeeks     = |period| × patternRatio          // fractional, not rounded
assignedWeeks     = weeks in the period with ≥ 1 assignment
periodBalance     = assignedWeeks − expectedWeeks    // negative ⇒ owed work
normalizedLoad    = assignedWeeks / expectedWeeks    // 1.0 = exactly on target
historicalBalance = the same, over a look-back window (default: one quarter)
```

People are ordered by `periodBalance`, then by `historicalBalance`, then by a stable ID.

## Why this shape

- **The current period comes first.** Someone who worked heavily last quarter but has had no
  work yet this period is under target *now*. History breaks ties; it does not dominate.
- **Fractional expected weeks.** Over a 3-week period, a 2/2 employee is expected to work 1.5
  weeks, not "1 or 2 depending on rounding". Balances stay comparable and add up sensibly.
- **One number, two presentations.** "Sea days" on screen is `assignedWeeks × 7`: the same
  number shown differently, not a second metric.
- **It self-corrects within a run.** During an engine run, `assignedWeeks` includes the
  placements made so far in that run.

## Consequences

The ranking inside the engine, the manager's workload table, reports and the simulator all show
the same fairness numbers. A post-run snapshot recomputes fairness when it is viewed, because
manual edits made after a run would make a frozen picture wrong.
