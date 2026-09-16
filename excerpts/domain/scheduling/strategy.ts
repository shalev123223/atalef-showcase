// Portfolio excerpt from ATALEF (src/domain/scheduling/strategy.ts). Shown for reading only; not runnable on its own.
// Imports point at modules not included in this repository.

import { RANK_FACTORS, DEFAULT_RANK_ORDER, type RankFactor } from "./rank";

/**
 * Selectable auto-assignment strategies.
 *
 * A strategy is nothing more than a permutation of the six ranking factors the engine already
 * compares lexicographically (rank.ts). It changes WHO gets picked among candidates who are
 * already eligible — it never relaxes a rule, and it never touches the hitch-copy pass, which
 * runs before ranking (engine.ts). This resolves the open product decision in
 * docs/architecture/00-overview.md §A00.8 item 1 ("trivially re-orderable").
 */
export const STRATEGY_IDS = ["BALANCED", "FAIRNESS_FIRST", "CONTINUITY_FIRST", "REST_FIRST", "EXPERTISE_FIRST", "CUSTOM"] as const;
export type StrategyId = (typeof STRATEGY_IDS)[number];
export type PresetId = Exclude<StrategyId, "CUSTOM">;

export interface StrategyDef { id: PresetId; order: readonly RankFactor[] }

/** BALANCED must stay byte-identical to DEFAULT_RANK_ORDER: nothing moves until a manager acts. */
export const STRATEGIES: readonly StrategyDef[] = [
  { id: "BALANCED", order: DEFAULT_RANK_ORDER },
  { id: "FAIRNESS_FIRST", order: ["FAIRNESS", "MATCH_QUALITY", "HITCH", "REST_QUALITY", "CONTINUITY", "SENIORITY"] },
  { id: "CONTINUITY_FIRST", order: ["HITCH", "CONTINUITY", "MATCH_QUALITY", "FAIRNESS", "REST_QUALITY", "SENIORITY"] },
  { id: "REST_FIRST", order: ["REST_QUALITY", "FAIRNESS", "MATCH_QUALITY", "HITCH", "CONTINUITY", "SENIORITY"] },
  { id: "EXPERTISE_FIRST", order: ["MATCH_QUALITY", "CONTINUITY", "HITCH", "SENIORITY", "FAIRNESS", "REST_QUALITY"] },
];

export const DEFAULT_STRATEGY_ID: StrategyId = "BALANCED";

export function isStrategyId(v: unknown): v is StrategyId {
  return typeof v === "string" && (STRATEGY_IDS as readonly string[]).includes(v);
}

/**
 * Always returns a TOTAL permutation of RANK_FACTORS: unknown and duplicate entries are dropped,
 * missing ones are appended in default order. A partial order would silently demote the omitted
 * factors to the arbitrary employee-id tie-break, which is not what "priority order" means.
 */
export function normalizeRankOrder(raw: readonly string[]): readonly RankFactor[] {
  const seen = new Set<RankFactor>();
  const out: RankFactor[] = [];
  for (const r of raw) {
    const f = r as RankFactor;
    if ((RANK_FACTORS as readonly string[]).includes(r) && !seen.has(f)) { seen.add(f); out.push(f); }
  }
  for (const f of RANK_FACTORS) if (!seen.has(f)) out.push(f);
  return out;
}

export function orderForStrategy(id: StrategyId, custom?: readonly RankFactor[] | null): readonly RankFactor[] {
  if (id === "CUSTOM") return normalizeRankOrder(custom ?? []);
  return STRATEGIES.find((s) => s.id === id)?.order ?? DEFAULT_RANK_ORDER;
}

export function parseRankOrder(csv?: string | null): readonly RankFactor[] | null {
  const trimmed = (csv ?? "").trim();
  if (!trimmed) return null;
  return normalizeRankOrder(trimmed.split(",").map((x) => x.trim()));
}

export function serializeRankOrder(order: readonly RankFactor[]): string {
  return normalizeRankOrder(order).join(",");
}
