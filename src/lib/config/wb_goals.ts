// Goals for the WB report, in minutes. Lower is better for every goal here.
// Shared by the web report and the PPTX export so both judge pass/fail the same way.
// Kept as one object so it can later become a function of package/shift without touching callers.

export const WB_GOALS = {
  /** Mean time to wait (MTTW) for M/C DOWN and for Setup jobs. */
  waitMin: 60,
  /** Mean time to repair (MTTR) of Setup+Conv jobs. */
  setupMin: 45,
  /** Wait share of shift time (%) drawn as the goal line on the Utilization / Loss trend. */
  waitPct: 5,
  /** Close rate (%) drawn as the goal line on the Job Request / Close trend. Higher is better. */
  closeRatePct: 90,
} as const;

export interface GoalResult {
  /** actual − goal, in minutes. Positive means over goal. */
  delta: number;
  /** True when actual is at or under the goal. */
  ok: boolean;
  /** Badge text such as "+88m" or "−10m". */
  text: string;
}

/**
 * Compares an average against its goal.
 * Returns null when there is no data (actual is 0 or missing), so callers show "—" instead of a
 * misleading green "−60m" for a shift that had no events.
 */
export function goalDelta(actual: number | null | undefined, goal: number): GoalResult | null {
  if (!actual) return null;
  // Judge on the whole-minute difference, the same number the badge shows, so colour and text never disagree
  // (no red "+0m"). The report's averages are already whole minutes.
  const delta = Math.round(actual - goal);
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return { delta, ok: delta <= 0, text: `${sign}${Math.abs(delta)}m` };
}
