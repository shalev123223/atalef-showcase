// Portfolio excerpt from ATALEF (src/domain/rotation/restEvaluation.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import type { IsoDate, WorkPattern } from "../shared/types";
import { nextWeek, prevWeek } from "../shared/week";
import type { RestInfo } from "../scheduling/types";

export function preferredRestWeeks(pattern: WorkPattern): number {
  return pattern === "TWO_FOUR" ? 4 : 2;
}

/** Block length of the pattern (both 2/2 and 2/4 work 2 consecutive weeks). */
export function workBlockWeeks(_pattern: WorkPattern): number {
  return 2;
}

const MAX_LOOKBACK = 104;

/**
 * The single rest/rotation evaluation. `worked` is the set of week starts in
 * which the employee has ≥1 assignment (history + in-run placements), evaluated
 * as of `weekStart` being a candidate work week.
 */
export function evaluateRest(worked: ReadonlySet<IsoDate>, weekStart: IsoDate, pattern: WorkPattern, maxConsecutiveWeeks: number): RestInfo {
  let precedingStreak = 0;
  let w = prevWeek(weekStart);
  while (worked.has(w) && precedingStreak < MAX_LOOKBACK) { precedingStreak++; w = prevWeek(w); }
  let followingStreak = 0;
  w = nextWeek(weekStart);
  while (worked.has(w) && followingStreak < MAX_LOOKBACK) { followingStreak++; w = nextWeek(w); }
  let restWeeksTaken = 0;
  if (precedingStreak === 0) {
    w = prevWeek(weekStart);
    while (!worked.has(w) && restWeeksTaken < MAX_LOOKBACK) { restWeeksTaken++; w = prevWeek(w); }
  }
  const preferredRest = preferredRestWeeks(pattern);
  const midBlock = precedingStreak > 0 && precedingStreak < maxConsecutiveWeeks;
  return {
    precedingStreak,
    followingStreak,
    resultingStreak: precedingStreak + 1 + followingStreak,
    restWeeksTaken,
    preferredRest,
    restDeviation: precedingStreak === 0 ? restWeeksTaken - preferredRest : 0,
    midBlock,
  };
}

export type RestVerdict = { kind: "OK" } | { kind: "REST_VIOLATION"; streak: number } | { kind: "CONSECUTIVE_LIMIT"; streak: number; max: number };

/** Minimum-rest rule: after maxConsecutiveWeeks consecutive work weeks ≥1 rest week is required. */
export function restVerdict(rest: RestInfo, maxConsecutiveWeeks: number): RestVerdict {
  if (rest.precedingStreak >= maxConsecutiveWeeks) return { kind: "REST_VIOLATION", streak: rest.precedingStreak };
  if (rest.resultingStreak > maxConsecutiveWeeks) return { kind: "CONSECUTIVE_LIMIT", streak: rest.resultingStreak, max: maxConsecutiveWeeks };
  return { kind: "OK" };
}

export interface ComplianceFinding { employeeId: string; weekStart: IsoDate; kind: "OVER_STREAK" | "UNDER_REST" | "EXCESS_REST"; value: number; target: number }

/** Rotation compliance over a range (report): streaks longer than max, blocks started with under-preferred rest, long idle gaps. */
export function rotationCompliance(worked: ReadonlySet<IsoDate>, weeksInRange: readonly IsoDate[], pattern: WorkPattern, maxConsecutiveWeeks: number, employeeId: string): ComplianceFinding[] {
  const out: ComplianceFinding[] = [];
  const preferred = preferredRestWeeks(pattern);
  for (const w of weeksInRange) {
    if (!worked.has(w)) continue;
    const r = evaluateRest(worked, w, pattern, maxConsecutiveWeeks);
    if (r.precedingStreak + 1 > maxConsecutiveWeeks && r.followingStreak === 0) out.push({ employeeId, weekStart: w, kind: "OVER_STREAK", value: r.precedingStreak + 1, target: maxConsecutiveWeeks });
    if (r.precedingStreak === 0 && r.restWeeksTaken < preferred && r.restWeeksTaken < MAX_LOOKBACK) out.push({ employeeId, weekStart: w, kind: "UNDER_REST", value: r.restWeeksTaken, target: preferred });
    if (r.precedingStreak === 0 && r.restWeeksTaken >= preferred * 3 && r.restWeeksTaken < MAX_LOOKBACK) out.push({ employeeId, weekStart: w, kind: "EXCESS_REST", value: r.restWeeksTaken, target: preferred });
  }
  return out;
}
