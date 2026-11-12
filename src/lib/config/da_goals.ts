// Goals for the DA (Die Attach) report. Separate from wb_goals.ts because DA's targets differ:
// Setup is 60 minutes (WB uses 45) and the low-utilisation line is 80% (WB uses 85).
// Lower is better for the time goals; a machine is "low" when its utilisation is below utilLowPct.
import { goalDelta } from '$lib/config/wb_goals';

export { goalDelta };

export const DA_GOALS = {
  /** Mean time to wait (MTTW) for M/C DOWN and for Setup jobs. */
  waitMin: 60,
  /** Mean time to repair (MTTR) of Setup+Conv jobs. */
  setupMin: 60,
  /** A machine is counted as low-utilisation when its utilisation is below this percent. */
  utilLowPct: 80,
} as const;
