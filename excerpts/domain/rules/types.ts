// Portfolio excerpt from ATALEF (src/domain/rules/types.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

export type RuleClass = "INTEGRITY" | "OPERATIONAL" | "WARNING";

export interface RuleResult {
  code: string;
  cls: RuleClass;
  /** Exact Hebrew text shown to the user and snapshotted on override. */
  message: string;
  data?: Record<string, unknown>;
}

export interface RuleDef<TData = Record<string, unknown>> {
  code: string;
  cls: RuleClass;
  /** Short Hebrew title for lists/filters. */
  title: string;
  messageHe: (data: TData) => string;
}
