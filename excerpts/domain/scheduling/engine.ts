// Portfolio excerpt from ATALEF (src/domain/scheduling/engine.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import type { AssignmentRecord, CandidateEvaluation, PositionRequirement, SchedulingContext } from "./types";
import { RunState, posKey } from "./state";
import { evaluateCandidate } from "./evaluate";
import { rankCandidates, explainFactors, type RankFactor, DEFAULT_RANK_ORDER } from "./rank";
import { ROLE_RARITY_ORDER } from "../shared/roleCapability";
import { hitchPartner } from "./hitch";
import { weekRange, prevWeek } from "../shared/week";
import { rule } from "../rules/registry";
import type { RuleResult } from "../rules/types";
import type { IsoDate } from "../shared/types";
import { ROLE_LABELS, ruleTitle } from "../../i18n/he-rules";

export interface PositionExplain {
  position: PositionRequirement;
  outcome: "FILLED" | "COPIED_FROM_HITCH" | "UNFILLED" | "PRE_EXISTING";
  chosen?: { employeeId: string; employeeName: string; factors: string[]; warnings: string[] };
  poolSize: number;
  /** Top rejected/excluded candidates with reason codes (compact). */
  others: { employeeId: string; employeeName: string; status: "RANKED_LOWER" | "EXCLUDED"; codes: string[] }[];
  unfilledReason?: string;
}

export interface RunResult {
  assignments: AssignmentRecord[];
  unfilled: PositionRequirement[];
  warnings: RuleResult[];
  explain: PositionExplain[];
  filledCount: number;
  unfilledCount: number;
}

export interface EngineOptions { rankOrder?: readonly RankFactor[]; topN?: number }

/** Lookback weeks (history window) before the fairness period. */
export function lookbackWeeksFor(ctx: SchedulingContext): IsoDate[] {
  const start = ctx.periodWeeks[0];
  if (!start || ctx.settings.fairnessLookbackWeeks <= 0) return [];
  let w = prevWeek(start);
  const out: IsoDate[] = [];
  for (let i = 0; i < ctx.settings.fairnessLookbackWeeks; i++) { out.unshift(w); w = prevWeek(w); }
  return out;
}

function roleRarity(role: string): number {
  const i = ROLE_RARITY_ORDER.indexOf(role as never);
  return i === -1 ? 99 : i;
}

/**
 * The unified automatic scheduling engine (A07 §7.6). Pure: no I/O.
 * Manual (source=MANUAL) assignments are never touched.
 */
export function runEngine(ctx: SchedulingContext, opts: EngineOptions = {}): RunResult {
  const state = new RunState(ctx);
  const order = opts.rankOrder ?? DEFAULT_RANK_ORDER;
  const topN = opts.topN ?? 5;
  const lookbackWeeks = lookbackWeeksFor(ctx);
  const employees = ctx.employees.filter((e) => e.status === "ACTIVE");
  const assetOrder = new Map(ctx.assets.map((a) => [a.id, a.sortOrder]));
  const weeks = [...ctx.weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  const selected = new Set(weeks.map((w) => w.weekStart));
  const result: RunResult = { assignments: [], unfilled: [], warnings: [], explain: [], filledCount: 0, unfilledCount: 0 };
  const evalOpts = { lookbackWeeks };

  for (const week of weeks) {
    const all = ctx.positions.filter((p) => p.weekStart === week.weekStart);
    let open = all.filter((p) => !state.occupant(p));
    for (const p of all.filter((p) => state.occupant(p))) result.explain.push({ position: p, outcome: "PRE_EXISTING", poolSize: 0, others: [] });

    // Hitch handling: second week copies the first week's AUTO placements where still eligible.
    const partner = hitchPartner(week.weekStart, ctx.hitchAnchors);
    if (partner && partner < week.weekStart && selected.has(partner)) {
      const remaining: PositionRequirement[] = [];
      for (const p of open) {
        const src = state.occupant({ ...p, weekStart: partner });
        const placedByRun = src && result.assignments.some((a) => posKey(a) === posKey(src));
        const emp = src && placedByRun ? employees.find((e) => e.id === src.employeeId) : undefined;
        if (emp) {
          const ev = evaluateCandidate(ctx, state, emp, p, { ...evalOpts, skipHitchProbe: true });
          if (ev.eligible) {
            const a: AssignmentRecord = { ...p, employeeId: emp.id, source: "AUTO" };
            state.place(a);
            result.assignments.push(a);
            result.filledCount++;
            result.warnings.push(...ev.rules.filter((r) => r.cls === "WARNING"));
            result.explain.push({ position: p, outcome: "COPIED_FROM_HITCH", chosen: { employeeId: emp.id, employeeName: emp.fullName, factors: ["המשך סבב משבוע קודם", ...explainFactors(ev)], warnings: ev.rules.filter((r) => r.cls === "WARNING").map((r) => r.message) }, poolSize: 1, others: [] });
            continue;
          }
          result.warnings.push(rule("HITCH_SPLIT", { assetName: ctx.assets.find((a) => a.id === p.assetId)?.name ?? p.assetId, roleLabel: ROLE_LABELS[p.role] }));
        }
        remaining.push(p);
      }
      open = remaining;
    }

    // Scarcity-first loop: pools are recomputed every iteration. Evaluations are cached per
    // (position, employee) and invalidated only for the employee just placed — placing X does
    // not change any other employee's evaluation within the week.
    const cache = new Map<string, Map<string, CandidateEvaluation>>();
    const evalFor = (p: PositionRequirement) => {
      const k = posKey(p);
      let m = cache.get(k);
      if (!m) { m = new Map(); cache.set(k, m); }
      const out: CandidateEvaluation[] = [];
      for (const e of employees) {
        let ev = m.get(e.id);
        if (!ev) { ev = evaluateCandidate(ctx, state, e, p, evalOpts); m.set(e.id, ev); }
        out.push(ev);
      }
      return out;
    };
    const invalidate = (employeeId: string) => { for (const m of cache.values()) m.delete(employeeId); };
    while (open.length) {
      const pools = open.map((p) => {
        const evals = evalFor(p);
        return { p, evals, pool: evals.filter((e) => e.eligible) };
      });
      pools.sort((a, b) => a.pool.length - b.pool.length || roleRarity(a.p.role) - roleRarity(b.p.role) || (assetOrder.get(a.p.assetId) ?? 0) - (assetOrder.get(b.p.assetId) ?? 0) || a.p.slotIndex - b.p.slotIndex);
      const target = pools[0]!;
      open = open.filter((p) => posKey(p) !== posKey(target.p));
      const excluded = target.evals.filter((e) => !e.eligible);
      if (target.pool.length === 0) {
        result.unfilled.push(target.p);
        result.unfilledCount++;
        result.explain.push({ position: target.p, outcome: "UNFILLED", poolSize: 0, others: summarizeOthers([], excluded, topN), unfilledReason: unfilledReason(excluded) });
        continue;
      }
      const ranked = rankCandidates(target.pool, order);
      const chosen = ranked[0]!;
      const a: AssignmentRecord = { ...target.p, employeeId: chosen.employeeId, source: "AUTO" };
      state.place(a);
      invalidate(chosen.employeeId);
      result.assignments.push(a);
      result.filledCount++;
      const warns = chosen.rules.filter((r) => r.cls === "WARNING");
      result.warnings.push(...warns);
      result.explain.push({ position: target.p, outcome: "FILLED", chosen: { employeeId: chosen.employeeId, employeeName: chosen.employeeName, factors: explainFactors(chosen), warnings: warns.map((r) => r.message) }, poolSize: target.pool.length, others: summarizeOthers(ranked.slice(1), excluded, topN) });
    }
  }
  return result;
}

function summarizeOthers(rankedLower: CandidateEvaluation[], excluded: CandidateEvaluation[], topN: number): PositionExplain["others"] {
  const lower = rankedLower.slice(0, topN).map((c) => ({ employeeId: c.employeeId, employeeName: c.employeeName, status: "RANKED_LOWER" as const, codes: [] as string[] }));
  const ex = excluded.filter((c) => !c.rules.some((r) => r.code === "ROLE_MISMATCH" || r.code === "EMP_NOT_SCHEDULABLE")).slice(0, topN).map((c) => ({ employeeId: c.employeeId, employeeName: c.employeeName, status: "EXCLUDED" as const, codes: c.rules.filter((r) => r.cls !== "WARNING").map((r) => r.code) }));
  return [...lower, ...ex];
}

function unfilledReason(excluded: CandidateEvaluation[]): string {
  const counts = new Map<string, number>();
  for (const c of excluded) {
    if (c.rules.some((r) => r.code === "ROLE_MISMATCH")) continue;
    for (const r of c.rules) if (r.cls !== "WARNING") counts.set(r.code, (counts.get(r.code) ?? 0) + 1);
  }
  const qualified = excluded.filter((c) => !c.rules.some((r) => r.code === "ROLE_MISMATCH")).length;
  if (qualified === 0) return "אין עובדים המוסמכים לתפקיד זה";
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code, n]) => `${ruleTitle(code)} (${n})`);
  return `${qualified} מוסמכים, כולם נפסלו: ${parts.join(", ")}`;
}

export { weekRange };
