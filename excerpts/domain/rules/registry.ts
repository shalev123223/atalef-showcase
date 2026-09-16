// Portfolio excerpt from ATALEF (src/domain/rules/registry.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import type { RuleClass, RuleDef, RuleResult } from "./types";

function def<T extends Record<string, unknown>>(code: string, cls: RuleClass, title: string, messageHe: (d: T) => string): RuleDef<T> {
  return { code, cls, title, messageHe };
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/**
 * The single rule registry. Every business rule that can fail or warn on a user
 * action is declared here once (docs/architecture/10 §10.1).
 */
export const RULES = {
  // ── Scheduling ──────────────────────────────────────────────────────────
  SLOT_OCCUPIED: def("SLOT_OCCUPIED", "INTEGRITY", "המשבצת תפוסה", (d) => `המשבצת כבר מאוישת על ידי ${str(d.occupantName)}. יש להסיר את השיבוץ הקיים תחילה.`),
  EMP_NOT_SCHEDULABLE: def("EMP_NOT_SCHEDULABLE", "INTEGRITY", "עובד לא זמין לשיבוץ", (d) => `${str(d.employeeName)} אינו במצב פעיל (${str(d.statusLabel)}) ולכן לא ניתן לשבצו.`),
  EMP_NO_ASSET: def("EMP_NO_ASSET", "INTEGRITY", "לא הוגדר נכס מבצעי", (d) => `ל${str(d.employeeName)} לא הוגדר אף נכס מבצעי. יש להשלים את הגדרת העובד לפני שיבוץ.`),
  ROLE_MISMATCH: def("ROLE_MISMATCH", "INTEGRITY", "אי-התאמה בתפקיד", (d) => `${str(d.employeeName)} אינו מוסמך לתפקיד ${str(d.roleLabel)}.`),
  ASSET_NOT_AUTHORIZED: def("ASSET_NOT_AUTHORIZED", "OPERATIONAL", "נכס לא מורשה", (d) => `${str(d.employeeName)} אינו מורשה לנכס ${str(d.assetName)}.`),
  APPROVED_CONSTRAINT: def("APPROVED_CONSTRAINT", "OPERATIONAL", "אילוץ מאושר", (d) => `ל${str(d.employeeName)} אילוץ מאושר (${str(d.constraintTypeLabel)}) בתאריכים ${str(d.range)}.`),
  DOUBLE_BOOKED_WEEK: def("DOUBLE_BOOKED_WEEK", "OPERATIONAL", "שיבוץ כפול באותו שבוע", (d) => `${str(d.employeeName)} כבר משובץ השבוע ב${str(d.otherAssetName)} (${str(d.otherRoleLabel)}).`),
  REST_VIOLATION: def("REST_VIOLATION", "OPERATIONAL", "הפרת מנוחה", (d) => `${str(d.employeeName)} עבד ${str(d.streak)} שבועות רצופים ועדיין לא השלים שבוע מנוחה.`),
  CONSECUTIVE_LIMIT: def("CONSECUTIVE_LIMIT", "OPERATIONAL", "חריגה ממכסת שבועות רצופים", (d) => `שיבוץ זה יביא את ${str(d.employeeName)} ל-${str(d.streak)} שבועות עבודה רצופים (המקסימום: ${str(d.max)}).`),
  PUBLISHED_WEEK_EDIT: def("PUBLISHED_WEEK_EDIT", "OPERATIONAL", "עריכת שבוע מפורסם", (d) => `השבוע ${str(d.weekLabel)} כבר פורסם לעובדים. שינוי עכשיו ישפיע על שיבוץ שכבר נראה.`),
  RESET_MANUAL_ASSIGNMENTS: def("RESET_MANUAL_ASSIGNMENTS", "OPERATIONAL", "איפוס שיבוצים ידניים", (d) => `הפעולה תמחק ${str(d.count)} שיבוצים ידניים בשבוע ${str(d.weekLabel)}.`),
  // ── publishing a planning variant ──
  PLAN_WEEK_MISSING: def("PLAN_WEEK_MISSING", "INTEGRITY", "שבוע חסר בלוח", (d) => `השבוע ${str(d.weekLabel)} אינו קיים בלוח השיבוצים — יש ליצור אותו לפני הפרסום.`),
  PLAN_SLOT_GONE: def("PLAN_SLOT_GONE", "OPERATIONAL", "משבצת שירדה מהתקן", (d) => `המשבצת ${str(d.slotLabel)} בשבוע ${str(d.weekLabel)} כבר אינה בתקן — השיבוץ יפורסם כחריג לתקן.`),
  PLAN_STALE_EMPLOYEE: def("PLAN_STALE_EMPLOYEE", "INTEGRITY", "עובד שאינו זמין לשיבוץ", (d) => `${str(d.employeeName)} אינו זמין לשיבוץ כיום (הסטטוס השתנה מאז הכנת התוכנית).`),
  QUALIFICATION_EXPIRED: def("QUALIFICATION_EXPIRED", "WARNING", "הסמכה פגת תוקף", (d) => `הסמכת ${str(d.trainingName)} של ${str(d.employeeName)} פגה בתאריך ${str(d.expiresOn)}.`),
  QUALIFICATION_EXPIRING: def("QUALIFICATION_EXPIRING", "WARNING", "הסמכה עומדת לפוג", (d) => `הסמכת ${str(d.trainingName)} של ${str(d.employeeName)} תפוג בתאריך ${str(d.expiresOn)}.`),
  QUALIFICATION_MISSING: def("QUALIFICATION_MISSING", "WARNING", "הסמכה חסרה", (d) => `ל${str(d.employeeName)} אין רישום הסמכה ב${str(d.trainingName)}.`),
  PENDING_CONSTRAINT: def("PENDING_CONSTRAINT", "WARNING", "אילוץ ממתין לאישור", (d) => `ל${str(d.employeeName)} אילוץ ממתין לאישור בתאריכים ${str(d.range)}.`),
  PATTERN_DEVIATION: def("PATTERN_DEVIATION", "WARNING", "חריגה מתבנית העבודה", (d) => `${str(d.employeeName)} כבר מעבר ליעד תבנית העבודה שלו בתקופה (עומס ${str(d.load)}).`),
  BELOW_PREFERRED_REST: def("BELOW_PREFERRED_REST", "WARNING", "מנוחה קצרה מהמועדף", (d) => `${str(d.employeeName)} נח ${str(d.rest)} שבועות בלבד (מועדף: ${str(d.preferred)}).`),
  HITCH_SPLIT: def("HITCH_SPLIT", "WARNING", "פיצול סבב", (d) => `השיבוץ ב${str(d.assetName)} (${str(d.roleLabel)}) לא הושלם לשני שבועות הסבב.`),
  // ── Constraints ─────────────────────────────────────────────────────────
  CONSTRAINT_ABNORMAL_TRANSITION: def("CONSTRAINT_ABNORMAL_TRANSITION", "OPERATIONAL", "מעבר מצב חריג באילוץ", (d) => `האילוץ נמצא במצב "${str(d.fromLabel)}" ולא ניתן בדרך כלל לעבור ממנו ל"${str(d.toLabel)}".`),
  CONSTRAINT_APPROVED_EDIT: def("CONSTRAINT_APPROVED_EDIT", "OPERATIONAL", "עריכת אילוץ מאושר", (d) => `האילוץ כבר אושר; שינוי התאריכים ישפיע על זמינות לשיבוץ (${str(d.range)}).`),
  CONSTRAINT_OVERLAP: def("CONSTRAINT_OVERLAP", "WARNING", "חפיפה עם אילוץ קיים", (d) => `קיים אילוץ נוסף של העובד בתאריכים חופפים (${str(d.range)}).`),
  CONSTRAINT_LATE: def("CONSTRAINT_LATE", "WARNING", "אילוץ מאוחר", (d) => `האילוץ הוגש אחרי פרסום השבוע ${str(d.weekLabel)}.`),
  // ── Training ────────────────────────────────────────────────────────────
  TRAINING_CAPACITY_EXCEEDED: def("TRAINING_CAPACITY_EXCEEDED", "OPERATIONAL", "חריגה מקיבולת", (d) => `האירוע מלא (${str(d.count)}/${str(d.capacity)}). אישור נוסף יחרוג מהקיבולת.`),
  TRAINING_ROLE_GATE: def("TRAINING_ROLE_GATE", "OPERATIONAL", "תפקיד לא מתאים להכשרה", (d) => `${str(d.employeeName)} אינו מחזיק בתפקיד הנדרש להכשרה ${str(d.trainingName)}.`),
  TRAINING_EVENT_STATE: def("TRAINING_EVENT_STATE", "INTEGRITY", "מצב אירוע לא מתאים", (d) => `לא ניתן לבצע את הפעולה כשהאירוע במצב "${str(d.statusLabel)}".`),
  // ── Staffing ────────────────────────────────────────────────────────────
  STAFFING_AFFECTS_PUBLISHED: def("STAFFING_AFFECTS_PUBLISHED", "OPERATIONAL", "השפעה על שבועות מפורסמים", (d) => `השינוי בתקן משפיע על ${str(d.count)} שבועות שכבר פורסמו.`),
  STAFFING_OVERRIDE_OVERLAP: def("STAFFING_OVERRIDE_OVERLAP", "INTEGRITY", "חפיפת תקנים זמניים", (d) => `קיים כבר תקן זמני לנכס בתקופה ${str(d.range)}.`),
  // ── Employees ───────────────────────────────────────────────────────────
  EMPLOYEE_ILLEGAL_TRANSITION: def("EMPLOYEE_ILLEGAL_TRANSITION", "INTEGRITY", "מעבר מצב לא חוקי", (d) => `לא ניתן לעבור ממצב "${str(d.fromLabel)}" למצב "${str(d.toLabel)}".`),
} as const;

export type RuleCode = keyof typeof RULES;

export function rule<C extends RuleCode>(code: C, data: Parameters<(typeof RULES)[C]["messageHe"]>[0]): RuleResult {
  const d = RULES[code];
  return { code, cls: d.cls, message: (d.messageHe as (x: unknown) => string)(data), data };
}

export function ruleTitle(code: string): string {
  return (RULES as Record<string, RuleDef>)[code]?.title ?? code;
}

export function hasIntegrity(results: readonly RuleResult[]): boolean {
  return results.some((r) => r.cls === "INTEGRITY");
}
export function operational(results: readonly RuleResult[]): RuleResult[] {
  return results.filter((r) => r.cls === "OPERATIONAL");
}
export function warnings(results: readonly RuleResult[]): RuleResult[] {
  return results.filter((r) => r.cls === "WARNING");
}
export function integrity(results: readonly RuleResult[]): RuleResult[] {
  return results.filter((r) => r.cls === "INTEGRITY");
}
