// Portfolio excerpt from ATALEF (src/domain/scheduling/engine.test.ts — first test blocks). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import { beforeEach, describe, expect, it } from "vitest";
import { runEngine } from "./engine";
import { evaluateCandidate } from "./evaluate";
import { rankCandidates, DEFAULT_RANK_ORDER } from "./rank";
import { STRATEGIES, orderForStrategy } from "./strategy";
import { RunState } from "./state";
import { makeContext, makeEmployee, positionsFor, hist, resetIds } from "./testkit";
import { weekRange } from "../shared/week";
import { pairHitches, hitchPhase, hitchPartner } from "./hitch";

const W = weekRange("2026-09-01", 8);
const codes = (ctx: ReturnType<typeof makeContext>, empIdx: number, pos = ctx.positions[0]!) => {
  const st = new RunState(ctx);
  return evaluateCandidate(ctx, st, ctx.employees[empIdx]!, pos, { lookbackWeeks: [] }).rules.map((r) => r.code).sort();
};

beforeEach(resetIds);

describe("eligibility rules — every code fires at its boundary", () => {
  it("INTEGRITY: not schedulable, no asset, role mismatch, slot occupied", () => {
    const ctx = makeContext({ employees: [
      makeEmployee({ status: "INACTIVE" }),
      makeEmployee({ assets: [] }),
      makeEmployee({ roles: ["SECURITY_GUARD"] }),
      makeEmployee(),
      makeEmployee(),
    ], positions: positionsFor([W[0]!], "A", [["MEDIC", 1]]), existingAssignments: [hist("5", W[0]!, "A", "MEDIC")] });
    expect(codes(ctx, 0)).toContain("EMP_NOT_SCHEDULABLE");
    expect(codes(ctx, 1)).toContain("EMP_NO_ASSET");
    expect(codes(ctx, 1)).not.toContain("ASSET_NOT_AUTHORIZED"); // empty ≠ all, and not double-reported
    expect(codes(ctx, 2)).toContain("ROLE_MISMATCH");
    expect(codes(ctx, 3)).toContain("SLOT_OCCUPIED");
    const st = new RunState(ctx);
    expect(evaluateCandidate(ctx, st, ctx.employees[4]!, ctx.positions[0]!, { lookbackWeeks: [] }).rules.map((r) => r.code)).not.toContain("SLOT_OCCUPIED");
    expect(codes(makeContext({ employees: [makeEmployee({ roles: ["MEDIC"] })] }), 0)).not.toContain("ROLE_MISMATCH"); // medic may fill a guard slot via substitution
  });
  it("OPERATIONAL: asset not authorized, approved constraint, double booking, rest violation, consecutive limit", () => {
    const ctx = makeContext({ employees: [
      makeEmployee({ assets: ["B"] }),
      makeEmployee(),
      makeEmployee(),
      makeEmployee(),
      makeEmployee(),
    ], constraints: [{ id: "c", employeeId: "2", startDate: "2026-09-03", endDate: "2026-09-03", status: "APPROVED", type: "LEAVE" }],
      existingAssignments: [hist("3", W[0]!, "B")],
      history: [hist("4", "2026-08-18"), hist("4", "2026-08-25"), hist("5", "2026-08-25"), hist("5", W[1]!)] });
    expect(codes(ctx, 0)).toContain("ASSET_NOT_AUTHORIZED");
    expect(codes(ctx, 1)).toContain("APPROVED_CONSTRAINT");
    expect(codes(ctx, 2)).toContain("DOUBLE_BOOKED_WEEK");
    expect(codes(ctx, 3)).toContain("REST_VIOLATION");
    expect(codes(ctx, 4)).toContain("CONSECUTIVE_LIMIT");
    const st = new RunState(ctx);
    const ev = evaluateCandidate(ctx, st, ctx.employees[0]!, ctx.positions[0]!, { lookbackWeeks: [] });
    expect(ev.eligible).toBe(false);
    expect(ev.overridable).toBe(true);
  });
  it("WARNING only: pending constraint, expired/expiring qualification, below preferred rest, pattern deviation", () => {
    const ctx = makeContext({ employees: [makeEmployee(), makeEmployee({ pattern: "TWO_FOUR" }), makeEmployee()],
      constraints: [{ id: "c", employeeId: "1", startDate: "2026-09-01", endDate: "2026-09-01", status: "PENDING", type: "LEAVE" }],
      qualifications: [
        { employeeId: "1", trainingTypeId: "t", trainingName: "ירי", expiresOn: "2026-08-01", lastCompleted: "2026-06-01", earlyWarningDays: 30 },
        { employeeId: "2", trainingTypeId: "t", trainingName: "ירי", expiresOn: "2026-09-20", lastCompleted: "2026-07-20", earlyWarningDays: 30 },
        { employeeId: "3", trainingTypeId: "t", trainingName: "ירי", expiresOn: null, lastCompleted: null, earlyWarningDays: 30 },
      ],
      history: [hist("2", "2026-08-18"), hist("2", "2026-08-11")], periodWeeks: [W[0]!] });
    expect(codes(ctx, 0)).toEqual(expect.arrayContaining(["PENDING_CONSTRAINT", "QUALIFICATION_EXPIRED", "PATTERN_DEVIATION"]));
    expect(codes(ctx, 1)).toEqual(expect.arrayContaining(["QUALIFICATION_EXPIRING", "BELOW_PREFERRED_REST"]));
    expect(codes(ctx, 2)).not.toContain("QUALIFICATION_MISSING");
    const st = new RunState(ctx);
    for (let i = 0; i < 3; i++) expect(evaluateCandidate(ctx, st, ctx.employees[i]!, ctx.positions[0]!, { lookbackWeeks: [] }).eligible).toBe(true);
  });
});

describe("ranking", () => {
  it("lexicographic: match quality → hitch → fairness → rest → continuity → seniority → id", () => {
    const ctx = makeContext({ employees: [
      makeEmployee({ id: "10", roles: ["COMMANDER"], assets: ["A"] }), // substitution into guard slot → tier 5
      makeEmployee({ id: "11", roles: ["SECURITY_GUARD"], assets: ["B", "A"] }), // tier 2 (primary role, secondary asset)
      makeEmployee({ id: "12", roles: ["SECURITY_GUARD"], assets: ["A"], hireDate: "2022-01-01" }), // tier 1
      makeEmployee({ id: "13", roles: ["SECURITY_GUARD"], assets: ["A"], hireDate: "2019-01-01" }), // tier 1, more senior
      makeEmployee({ id: "14", roles: ["SECURITY_GUARD"], assets: ["A"], hireDate: "2019-01-01" }), // tier 1 but worked 3 of last weeks in period → over target
    ], periodWeeks: W.slice(0, 4), history: [], existingAssignments: [hist("14", W[1]!), hist("14", W[2]!), hist("14", W[3]!)] });
    const st = new RunState(ctx);
    const evals = ctx.employees.map((e) => evaluateCandidate(ctx, st, e, ctx.positions[0]!, { lookbackWeeks: [] }));
    const ranked = rankCandidates(evals.filter((e) => e.eligible || e.overridable), DEFAULT_RANK_ORDER);
    // tier 1 first (13 before 12 by seniority; 14 is tier 1 but over target → after them), then tier 2, then substitution
    expect(ranked.map((r) => r.employeeId)).toEqual(["13", "12", "14", "11", "10"]);
  });
});

// … (strategy, scarcity, determinism, multi-week and hitch tests omitted)
