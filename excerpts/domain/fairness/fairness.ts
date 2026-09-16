// Portfolio excerpt from ATALEF (src/domain/fairness/fairness.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import type { IsoDate, WorkPattern } from "../shared/types";
import type { FairnessInfo } from "../scheduling/types";

/** THE fairness definition (docs/architecture/08). No other module may compute fairness. */
export function patternRatio(pattern: WorkPattern): number {
  return pattern === "TWO_FOUR" ? 1 / 3 : 1 / 2;
}

export function expectedWeeks(pattern: WorkPattern, periodLength: number): number {
  return periodLength * patternRatio(pattern);
}

/** Count of distinct weeks in `period` where the employee has ≥1 assignment. */
export function assignedWeeksIn(worked: ReadonlySet<IsoDate>, period: readonly IsoDate[]): number {
  let n = 0;
  for (const w of period) if (worked.has(w)) n++;
  return n;
}

export function computeFairness(pattern: WorkPattern, worked: ReadonlySet<IsoDate>, period: readonly IsoDate[], lookback: readonly IsoDate[]): FairnessInfo {
  const expected = expectedWeeks(pattern, period.length);
  const assigned = assignedWeeksIn(worked, period);
  const histExpected = expectedWeeks(pattern, lookback.length);
  const histAssigned = assignedWeeksIn(worked, lookback);
  return {
    expectedWeeks: expected,
    assignedWeeks: assigned,
    periodBalance: assigned - expected,
    normalizedLoad: expected > 0 ? assigned / expected : 0,
    historicalBalance: lookback.length ? histAssigned - histExpected : 0,
  };
}

/** Fairness value ordering: most under-target first; ties by historical balance. Returns 0 on a true tie. */
export function compareFairnessValues(a: FairnessInfo, b: FairnessInfo): number {
  const d = a.periodBalance - b.periodBalance;
  if (Math.abs(d) > 1e-9) return d;
  const h = a.historicalBalance - b.historicalBalance;
  if (Math.abs(h) > 1e-9) return h;
  return 0;
}

/** Fairness ordering with a stable id tie-break (for tables/lists). */
export function compareFairness(a: { fairness: FairnessInfo; employeeId: string }, b: { fairness: FairnessInfo; employeeId: string }): number {
  const c = compareFairnessValues(a.fairness, b.fairness);
  if (c !== 0) return c;
  return BigInt(a.employeeId) < BigInt(b.employeeId) ? -1 : BigInt(a.employeeId) > BigInt(b.employeeId) ? 1 : 0;
}

export interface FairnessRow extends FairnessInfo { employeeId: string; pattern: WorkPattern; seaDays: number; status: "UNDER" | "ON_TARGET" | "OVER" }

/** Tabular view reused by reports, dashboards and the planning simulator. */
export function fairnessTable(employees: readonly { id: string; workPattern: WorkPattern }[], workedByEmployee: ReadonlyMap<string, ReadonlySet<IsoDate>>, period: readonly IsoDate[], lookback: readonly IsoDate[], tolerance = 0.5): FairnessRow[] {
  const rows: FairnessRow[] = employees.map((e) => {
    const f = computeFairness(e.workPattern, workedByEmployee.get(e.id) ?? new Set(), period, lookback);
    return { employeeId: e.id, pattern: e.workPattern, ...f, seaDays: f.assignedWeeks * 7, status: f.periodBalance < -tolerance ? "UNDER" : f.periodBalance > tolerance ? "OVER" : "ON_TARGET" };
  });
  rows.sort((a, b) => compareFairness({ fairness: a, employeeId: a.employeeId }, { fairness: b, employeeId: b.employeeId }));
  return rows;
}

/** Build worked-week sets from assignment-like records. */
export function workedWeeks(records: readonly { employeeId: string; weekStart: IsoDate }[]): Map<string, Set<IsoDate>> {
  const m = new Map<string, Set<IsoDate>>();
  for (const r of records) {
    let s = m.get(r.employeeId);
    if (!s) { s = new Set(); m.set(r.employeeId, s); }
    s.add(r.weekStart);
  }
  return m;
}
