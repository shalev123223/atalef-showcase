// Portfolio excerpt from ATALEF (src/server/audit/override.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import type { Db } from "@/src/server/db/prisma";
import type { RuleResult } from "@/src/domain/rules/types";
import { integrity, operational, warnings, ruleTitle } from "@/src/domain/rules/registry";
import type { OverrideConsent } from "@/src/server/result";
import { recordAudit } from "./audit";
import type { Prisma } from "@prisma/client";

export type ProtocolOutcome =
  | { status: "integrity"; rules: RuleResult[] }
  | { status: "needs_override"; rules: RuleResult[] }
  | { status: "proceed"; warnings: RuleResult[]; overridden: RuleResult[] };

/**
 * The uniform override protocol (docs/architecture/10 §10.2).
 * - any INTEGRITY → hard fail
 * - any OPERATIONAL without matching consent → needs_override
 * - otherwise proceed with warnings + the list of overridden rules to record.
 */
export function applyOverrideProtocol(results: readonly RuleResult[], consent: OverrideConsent | undefined, canOverride: boolean): ProtocolOutcome {
  const hard = integrity(results);
  if (hard.length) return { status: "integrity", rules: hard };
  const ops = operational(results);
  if (ops.length) {
    const consentOk =
      canOverride && consent !== undefined && consent.reason.trim().length >= 3 && ops.every((r) => consent.ruleCodes.includes(r.code));
    if (!consentOk) return { status: "needs_override", rules: ops };
  }
  return { status: "proceed", warnings: warnings(results), overridden: ops };
}

export interface OverrideTarget {
  entityType: string;
  entityId?: bigint | null;
  employeeId?: bigint | null;
  /** Short Hebrew description of the action (for the audit summary). */
  actionSummary: string;
}

/** Persist override_record + paired audit event for each overridden rule. Returns the first override id. */
export async function recordOverrides(db: Db, actorAccountId: bigint, target: OverrideTarget, overridden: readonly RuleResult[], reason: string): Promise<bigint | null> {
  let first: bigint | null = null;
  const now = new Date();
  for (const r of overridden) {
    const audit = await recordAudit(db, {
      actorAccountId,
      action: "override.performed",
      entityType: target.entityType,
      entityId: target.entityId ?? null,
      summary: `אישור חריגה — ${ruleTitle(r.code)}: ${target.actionSummary}`,
      details: { ruleCode: r.code, reason } as Prisma.InputJsonValue,
    });
    const rec = await db.overrideRecord.create({
      data: {
        auditEventId: audit.id,
        ruleCode: r.code,
        entityType: target.entityType,
        entityId: target.entityId ?? null,
        employeeId: target.employeeId ?? null,
        reason,
        warningSnapshot: { code: r.code, message: r.message, data: r.data ?? {} } as Prisma.InputJsonValue,
        performedBy: actorAccountId,
        performedAt: now,
      },
    });
    first ??= rec.id;
  }
  return first;
}
