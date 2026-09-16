// Portfolio excerpt from ATALEF (src/server/services/scheduling/assignments.ts — selected functions).
// Shown for reading only; not runnable on its own. Imports point at modules not included here.

import { prisma } from "@/src/server/db/prisma";
import { accountDisplayName } from "@/src/server/auth/displayName";
import type { OperationalRole, WeekStatus } from "@prisma/client";
import { requirePermission, can } from "@/src/server/auth/authz";
import type { SessionContext } from "@/src/server/auth/session";
import { recordAudit } from "@/src/server/audit/audit";
import { applyOverrideProtocol, recordOverrides } from "@/src/server/audit/override";
import { ok, fail, needsOverride, type ActionResult, type OverrideConsent } from "@/src/server/result";
import { rule, ruleTitle } from "@/src/domain/rules/registry";
import type { RuleResult } from "@/src/domain/rules/types";
import { evaluateCandidate } from "@/src/domain/scheduling/evaluate";
import { RunState } from "@/src/domain/scheduling/state";
import { lookbackWeeksFor } from "@/src/domain/scheduling/engine";
import type { PositionRequirement, SchedulingContext } from "@/src/domain/scheduling/types";
// … (further imports and helpers omitted)

/** All assignment paths run this: evaluate → override protocol → persist + audit. */
export async function assignEmployee(ctx: SessionContext, pos: PositionRef, employeeId: bigint, consent?: OverrideConsent, opts: { replace?: boolean } = {}): Promise<ActionResult<{ assignmentId: string }>> {
  requirePermission(ctx, "schedule.manage");
  const week = await weekRowFor(pos.weekStart);
  if (!week) return fail("not_found", "השבוע לא נמצא.");
  if (week.status === "ARCHIVED") return fail("conflict", "לא ניתן לשבץ בשבוע שבארכיון. יש לשחזר אותו תחילה.");
  const sctx = await buildSchedulingContext({ weekStarts: [pos.weekStart], includeNonSchedulable: true });
  const emp = sctx.employees.find((e) => e.id === employeeId.toString());
  if (!emp) return fail("not_found", "העובד לא נמצא.");
  if (!sctx.positions.some((p) => p.assetId === pos.assetId && p.role === pos.role && p.slotIndex === pos.slotIndex && p.weekStart === pos.weekStart)) return fail("conflict", "המשבצת אינה קיימת בתקן של שבוע זה.");
  const state = new RunState(sctx);
  const position: PositionRequirement = { ...pos };
  const existing = state.occupant(position);
  if (existing && existing.employeeId === emp.id) return fail("conflict", "העובד כבר משובץ במשבצת זו.");
  if (existing && opts.replace) state.remove(position);
  const ev = evaluateCandidate(sctx, state, emp, position, { lookbackWeeks: lookbackWeeksFor(sctx) });
  const results: RuleResult[] = [...ev.rules];
  if (week.status === "PUBLISHED") results.push(rule("PUBLISHED_WEEK_EDIT", { weekLabel: fmtDate(pos.weekStart) }));
  const outcome = applyOverrideProtocol(results, consent, can(ctx, "override.perform"));
  if (outcome.status === "integrity") return fail("integrity", outcome.rules[0]!.message, outcome.rules);
  if (outcome.status === "needs_override") return needsOverride(outcome.rules);
  const assetName = sctx.assets.find((a) => a.id === pos.assetId)?.name ?? "";
  const id = await prisma.$transaction(async (tx) => {
    let overrideId: bigint | null = null;
    if (existing && opts.replace) {
      await tx.assignment.deleteMany({ where: { weekId: week.id, assetId: BigInt(pos.assetId), role: pos.role, slotIndex: pos.slotIndex } });
      const prevEmp = sctx.employees.find((e) => e.id === existing.employeeId);
      await recordAudit(tx, { actorAccountId: ctx.accountId, action: "schedule.removed", entityType: "schedule_week", entityId: week.id, summary: `${prevEmp?.fullName ?? existing.employeeId} הוסר מ${assetName} (${ROLE_LABELS[pos.role]} ${pos.slotIndex}) בשבוע ${fmtDate(pos.weekStart)} (הוחלף)` });
    }
    if (outcome.overridden.length) overrideId = await recordOverrides(tx, ctx.accountId, { entityType: "assignment", employeeId: BigInt(emp.id), actionSummary: `שיבוץ ${emp.fullName} ל${assetName} (${ROLE_LABELS[pos.role]}) בשבוע ${fmtDate(pos.weekStart)}` }, outcome.overridden, consent!.reason);
    const a = await tx.assignment.create({ data: { weekId: week.id, assetId: BigInt(pos.assetId), role: pos.role, slotIndex: pos.slotIndex, employeeId: BigInt(emp.id), source: "MANUAL", createdBy: ctx.accountId, overrideId } });
    if (overrideId) await tx.overrideRecord.updateMany({ where: { id: overrideId }, data: { entityId: a.id } });
    await recordAudit(tx, { actorAccountId: ctx.accountId, action: "schedule.assigned", entityType: "schedule_week", entityId: week.id, summary: `${emp.fullName} שובץ/ה ידנית ל${assetName} (${ROLE_LABELS[pos.role]} ${pos.slotIndex}) בשבוע ${fmtDate(pos.weekStart)}${overrideId ? " — באישור חריגה" : ""}` });
    return a.id;
  });
  return ok({ assignmentId: sidReq(id) }, outcome.warnings);
}

export async function removeAssignment(ctx: SessionContext, assignmentId: bigint, consent?: OverrideConsent): Promise<ActionResult<void>> {
  requirePermission(ctx, "schedule.manage");
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId }, include: { week: true, asset: true, employee: { select: { fullName: true } } } });
  if (!a) return fail("not_found", "השיבוץ לא נמצא.");
  if (a.week.status === "ARCHIVED") return fail("conflict", "לא ניתן לשנות שבוע בארכיון.");
  const results: RuleResult[] = a.week.status === "PUBLISHED" ? [rule("PUBLISHED_WEEK_EDIT", { weekLabel: fmtDate(isoReq(a.week.weekStart)) })] : [];
  const outcome = applyOverrideProtocol(results, consent, can(ctx, "override.perform"));
  if (outcome.status === "needs_override") return needsOverride(outcome.rules);
  if (outcome.status === "integrity") return fail("integrity", outcome.rules[0]!.message);
  await prisma.$transaction(async (tx) => {
    await tx.assignment.delete({ where: { id: assignmentId } });
    if (outcome.overridden.length) await recordOverrides(tx, ctx.accountId, { entityType: "schedule_week", entityId: a.weekId, employeeId: a.employeeId, actionSummary: `הסרת ${a.employee.fullName} משבוע מפורסם` }, outcome.overridden, consent!.reason);
    await recordAudit(tx, { actorAccountId: ctx.accountId, action: "schedule.removed", entityType: "schedule_week", entityId: a.weekId, summary: `${a.employee.fullName} הוסר/ה מ${a.asset.name} (${ROLE_LABELS[a.role]} ${a.slotIndex}) בשבוע ${fmtDate(isoReq(a.week.weekStart))}` });
  });
  return ok(undefined, outcome.warnings);
}

// … (swap and grid view-model helpers omitted)

/** Grid over a week range. Employees see PUBLISHED weeks only (drafts are the manager's work surface); request markers are visible to everyone. */
export async function gridView(ctx: SessionContext, weekStarts: IsoDate[]): Promise<GridView> {
  const manage = can(ctx, "schedule.manage");
  const sctx = await buildSchedulingContext({ weekStarts, includeNonSchedulable: true });
  const visibleWeeks = sctx.weeks.filter((w) => manage || w.status === "PUBLISHED");
  const visibleDates = visibleWeeks.map((w) => dateOf(w.weekStart)!);
  // … (grid assembly omitted)
}
