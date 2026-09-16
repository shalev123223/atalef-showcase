// Portfolio excerpt from ATALEF (src/domain/scheduling/rank.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import type { CandidateEvaluation } from "./types";
import { compareFairnessValues } from "../fairness/fairness";

/** The tuple is the single source: the type, the Zod enum and the strategy presets all derive from it. */
export const RANK_FACTORS = ["MATCH_QUALITY", "HITCH", "FAIRNESS", "REST_QUALITY", "CONTINUITY", "SENIORITY"] as const;
export type RankFactor = (typeof RANK_FACTORS)[number];

/**
 * Default lexicographic ranking order (A07 §7.6 default + hitch preference).
 * Re-orderable configuration — one place. Selectable strategies are permutations of it
 * (src/domain/scheduling/strategy.ts); "BALANCED" is this exact order.
 */
export const DEFAULT_RANK_ORDER: readonly RankFactor[] = RANK_FACTORS;

const cmpNum = <T extends number | string>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);
const bool = (b: boolean) => (b ? 0 : 1);

export const FACTOR_COMPARATORS: Record<RankFactor, (a: CandidateEvaluation, b: CandidateEvaluation) => number> = {
  MATCH_QUALITY: (a, b) => cmpNum(a.match?.tier ?? 9, b.match?.tier ?? 9),
  // continuing the hitch on the same asset first; then candidates who can also complete the upcoming second week
  HITCH: (a, b) => cmpNum(bool(a.continuity.hitchContinuation), bool(b.continuity.hitchContinuation)) || cmpNum(bool(a.continuity.hitchCompletable !== false), bool(b.continuity.hitchCompletable !== false)),
  FAIRNESS: (a, b) => compareFairnessValues(a.fairness, b.fairness),
  // at/above preferred rest before below; more rested first; mid-block candidates are neutral (0)
  REST_QUALITY: (a, b) => cmpNum(bool(a.rest.restDeviation >= 0), bool(b.rest.restDeviation >= 0)) || cmpNum(b.rest.restDeviation, a.rest.restDeviation),
  CONTINUITY: (a, b) => cmpNum(bool(a.continuity.sameAssetLastWeek), bool(b.continuity.sameAssetLastWeek)) || cmpNum(bool(a.continuity.sameRegionLastWeek), bool(b.continuity.sameRegionLastWeek)),
  SENIORITY: (a, b) => cmpNum(a.hireDate ?? "9999-12-31", b.hireDate ?? "9999-12-31"),
};

export function compareCandidates(a: CandidateEvaluation, b: CandidateEvaluation, order: readonly RankFactor[]): number {
  for (const f of order) {
    const c = FACTOR_COMPARATORS[f](a, b);
    if (c !== 0) return c;
  }
  return BigInt(a.employeeId) < BigInt(b.employeeId) ? -1 : BigInt(a.employeeId) > BigInt(b.employeeId) ? 1 : 0;
}

/** Deterministic ranking; stable on employee id. */
export function rankCandidates(pool: readonly CandidateEvaluation[], order: readonly RankFactor[]): CandidateEvaluation[] {
  return [...pool].sort((a, b) => compareCandidates(a, b, order));
}

/** Compact explanation of a candidate's rank factors (Hebrew, for the explainability UI). */
export function explainFactors(c: CandidateEvaluation): string[] {
  const out: string[] = [];
  if (c.match) out.push(c.match.kind === "SUBSTITUTION" ? "מילוי דרך יכולת חלופית" : c.match.tier === 1 ? "תפקיד ראשי ונכס ראשי" : c.match.tier === 2 ? "תפקיד ראשי, נכס משני" : c.match.tier === 3 ? "תפקיד משני, נכס ראשי" : "תפקיד משני, נכס משני");
  if (c.continuity.hitchContinuation) out.push("המשך סבב באותו נכס");
  out.push(`מאזן הוגנות ${c.fairness.periodBalance >= 0 ? "+" : ""}${c.fairness.periodBalance.toFixed(1)} שבועות (עומס ${c.fairness.normalizedLoad.toFixed(2)})`);
  if (c.rest.precedingStreak === 0) out.push(`מנוחה ${c.rest.restWeeksTaken >= 100 ? "ממושכת" : `${c.rest.restWeeksTaken} שבועות`} (מועדף ${c.rest.preferredRest})`);
  else out.push(`שבוע ${c.rest.precedingStreak + 1} ברצף`);
  if (c.continuity.sameAssetLastWeek) out.push("אותו נכס כבשבוע הקודם");
  return out;
}
