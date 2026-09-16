// Portfolio excerpt from ATALEF (src/domain/scheduling/evaluate.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import type { AssetRef, CandidateEvaluation, EmployeeSnapshot, MatchInfo, PositionRequirement, QualificationSnapshot, SchedulingContext } from "./types";
import type { RuleResult } from "../rules/types";
import { rule } from "../rules/registry";
import { roleMatch } from "../shared/roleCapability";
import { isSchedulable } from "../employee/lifecycle";
import { constraintStatusForWeek } from "../constraints/stateMachine";
import { evaluateRest, restVerdict } from "../rotation/restEvaluation";
import { computeFairness } from "../fairness/fairness";
import { statusOf } from "../training/expiry";
import { prevWeek, weekEndOf } from "../shared/week";
import { EMPLOYEE_STATUS_LABELS, ROLE_LABELS, CONSTRAINT_TYPE_LABELS, fmtDate, fmtNumber } from "../../i18n/he";
import type { RunState } from "./state";
import { hitchPartner } from "./hitch";
import type { IsoDate } from "../shared/types";
import type { ConstraintSpan } from "../constraints/stateMachine";

interface CtxIndex { qualsByEmp: Map<string, QualificationSnapshot[]>; consByEmp: Map<string, ConstraintSpan[]>; assetById: Map<string, AssetRef>; empById: Map<string, EmployeeSnapshot> }
const INDEX = new WeakMap<SchedulingContext, CtxIndex>();

/** Per-context lookup indexes (built once; the context is treated as immutable data). */
export function indexOf(ctx: SchedulingContext): CtxIndex {
  let idx = INDEX.get(ctx);
  if (idx) return idx;
  idx = { qualsByEmp: new Map(), consByEmp: new Map(), assetById: new Map(ctx.assets.map((a) => [a.id, a])), empById: new Map(ctx.employees.map((e) => [e.id, e])) };
  for (const q of ctx.qualifications) { const l = idx.qualsByEmp.get(q.employeeId) ?? []; l.push(q); idx.qualsByEmp.set(q.employeeId, l); }
  for (const c of ctx.constraints) { const l = idx.consByEmp.get(c.employeeId) ?? []; l.push(c); idx.consByEmp.set(c.employeeId, l); }
  INDEX.set(ctx, idx);
  return idx;
}

export function matchInfo(e: EmployeeSnapshot, p: PositionRequirement): MatchInfo | null {
  const kind = roleMatch(e.roles, p.role);
  if (kind === "NONE") return null;
  const primaryRole = e.primaryRole === p.role;
  const primaryAsset = e.primaryAssetId === p.assetId;
  if (kind === "SUBSTITUTION") return { tier: 5, kind, primaryRole: false, primaryAsset };
  const tier = primaryRole && primaryAsset ? 1 : primaryRole ? 2 : primaryAsset ? 3 : 4;
  return { tier, kind, primaryRole, primaryAsset };
}

export interface EvaluateOptions {
  /** Lookback weeks for historical fairness. */
  lookbackWeeks: IsoDate[];
  /** When true, skip the (expensive) hitch-completability probe. */
  skipHitchProbe?: boolean;
}

/**
 * THE candidate evaluation — used by the auto engine, the manual picker, swaps,
 * change-request approval and the planning simulator. Returns every rule result
 * (INTEGRITY / OPERATIONAL / WARNING) plus ranking inputs.
 */
export function evaluateCandidate(ctx: SchedulingContext, state: RunState, e: EmployeeSnapshot, p: PositionRequirement, opts: EvaluateOptions): CandidateEvaluation {
  const rules: RuleResult[] = [];
  const idx = indexOf(ctx);
  const asset = idx.assetById.get(p.assetId);
  const assetName = asset?.name ?? p.assetId;

  // ── INTEGRITY ──
  const occupant = state.occupant(p);
  if (occupant && occupant.employeeId !== e.id) {
    const occ = idx.empById.get(occupant.employeeId);
    rules.push(rule("SLOT_OCCUPIED", { occupantName: occ?.fullName ?? occupant.employeeId }));
  }
  if (!isSchedulable(e.status)) rules.push(rule("EMP_NOT_SCHEDULABLE", { employeeName: e.fullName, statusLabel: EMPLOYEE_STATUS_LABELS[e.status] }));
  if (e.assetIds.length === 0) rules.push(rule("EMP_NO_ASSET", { employeeName: e.fullName }));
  const match = matchInfo(e, p);
  if (!match) rules.push(rule("ROLE_MISMATCH", { employeeName: e.fullName, roleLabel: ROLE_LABELS[p.role] }));

  // ── OPERATIONAL ──
  if (e.assetIds.length > 0 && !e.assetIds.includes(p.assetId)) rules.push(rule("ASSET_NOT_AUTHORIZED", { employeeName: e.fullName, assetName }));
  const cs = constraintStatusForWeek(idx.consByEmp.get(e.id) ?? [], e.id, p.weekStart);
  if (cs.kind === "BLOCKED_APPROVED_CONSTRAINT") rules.push(rule("APPROVED_CONSTRAINT", { employeeName: e.fullName, constraintTypeLabel: CONSTRAINT_TYPE_LABELS[cs.constraint.type], range: `${fmtDate(cs.constraint.startDate)} – ${fmtDate(cs.constraint.endDate)}` }));
  const sameWeek = state.assignmentsOf(e.id, p.weekStart).filter((a) => !(a.assetId === p.assetId && a.role === p.role && a.slotIndex === p.slotIndex));
  if (sameWeek.length) {
    const other = sameWeek[0]!;
    rules.push(rule("DOUBLE_BOOKED_WEEK", { employeeName: e.fullName, otherAssetName: idx.assetById.get(other.assetId)?.name ?? other.assetId, otherRoleLabel: ROLE_LABELS[other.role] }));
  }
  // Rest is evaluated on the worked set EXCLUDING this very position (re-evaluation of an occupant must not count itself).
  const worked = new Set(state.workedOf(e.id));
  if (sameWeek.length === 0 && occupant?.employeeId === e.id) worked.delete(p.weekStart);
  const rest = evaluateRest(worked, p.weekStart, e.workPattern, ctx.settings.maxConsecutiveWeeks);
  const verdict = restVerdict(rest, ctx.settings.maxConsecutiveWeeks);
  if (verdict.kind === "REST_VIOLATION") rules.push(rule("REST_VIOLATION", { employeeName: e.fullName, streak: verdict.streak }));
  else if (verdict.kind === "CONSECUTIVE_LIMIT") rules.push(rule("CONSECUTIVE_LIMIT", { employeeName: e.fullName, streak: verdict.streak, max: verdict.max }));

  // ── WARNING ──
  if (cs.kind === "WARNING_PENDING_CONSTRAINT") rules.push(rule("PENDING_CONSTRAINT", { employeeName: e.fullName, range: `${fmtDate(cs.constraint.startDate)} – ${fmtDate(cs.constraint.endDate)}` }));
  const weekEnd = weekEndOf(p.weekStart);
  for (const q of idx.qualsByEmp.get(e.id) ?? []) {
    if (q.lastCompleted === null) continue; // MISSING is a readiness item, not a scheduling warning (A07 §7.4)
    const st = statusOf(q.expiresOn, weekEnd, q.earlyWarningDays);
    // trainingTypeId rides along unused by the message — the schedule screen filters on it (warningPolicy).
    if (st === "EXPIRED") rules.push(rule("QUALIFICATION_EXPIRED", { employeeName: e.fullName, trainingName: q.trainingName, trainingTypeId: q.trainingTypeId, expiresOn: fmtDate(q.expiresOn) }));
    else if (st === "EXPIRING") rules.push(rule("QUALIFICATION_EXPIRING", { employeeName: e.fullName, trainingName: q.trainingName, trainingTypeId: q.trainingTypeId, expiresOn: fmtDate(q.expiresOn) }));
  }
  if (verdict.kind === "OK" && rest.precedingStreak === 0 && rest.restDeviation < 0 && rest.restWeeksTaken < 100) rules.push(rule("BELOW_PREFERRED_REST", { employeeName: e.fullName, rest: rest.restWeeksTaken, preferred: rest.preferredRest }));

  // fairness as if this placement is made
  const workedAfter = new Set(worked);
  workedAfter.add(p.weekStart);
  const fairness = computeFairness(e.workPattern, workedAfter, ctx.periodWeeks, opts.lookbackWeeks);
  if (fairness.normalizedLoad > ctx.settings.patternDeviationThreshold) rules.push(rule("PATTERN_DEVIATION", { employeeName: e.fullName, load: fmtNumber(fairness.normalizedLoad, 2) }));

  // continuity
  const prev = prevWeek(p.weekStart);
  const last = state.lastWeekAssignment(e.id, prev);
  const lastAsset = last ? idx.assetById.get(last.assetId) : undefined;
  const partner = hitchPartner(p.weekStart, ctx.hitchAnchors);
  const hitchContinuation = !!last && partner === prev && last.assetId === p.assetId;
  let hitchCompletable: boolean | null = null;
  if (!opts.skipHitchProbe && partner && partner > p.weekStart && ctx.weeks.some((w) => w.weekStart === partner)) {
    const probe = evaluateCandidate(ctx, state, e, { ...p, weekStart: partner }, { ...opts, skipHitchProbe: true });
    hitchCompletable = probe.eligible;
  }

  const hasIntegrity = rules.some((r) => r.cls === "INTEGRITY");
  const hasOperational = rules.some((r) => r.cls === "OPERATIONAL");
  return {
    employeeId: e.id,
    employeeName: e.fullName,
    rules,
    eligible: !hasIntegrity && !hasOperational,
    overridable: !hasIntegrity && hasOperational,
    match,
    rest,
    fairness,
    continuity: { sameAssetLastWeek: !!last && last.assetId === p.assetId, sameRegionLastWeek: !!lastAsset && lastAsset.region === asset?.region, hitchContinuation, hitchCompletable },
    hireDate: e.hireDate,
  };
}
