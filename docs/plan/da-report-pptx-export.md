# Plan: DA report — 7-day trend API + PPTX export (single slide)

Status: approved (answers from the user): DA uses `job_listx`; start with backend; OK to edit `Dashboad_API_rush`.
Backend work: branch `feat/da-report-7day` in `D:\claude\Dashboad_API_rush` (done, compiles; live test pending).
Base: [wb-report-pptx-export.md](wb-report-pptx-export.md), [wb-report-goal-and-single-slide.md](wb-report-goal-and-single-slide.md)

## 1. Decisions

| Item | Decision |
|---|---|
| Page title | "Die Attach — Utilization & Downtime" (as the DA page already shows) |
| Trend & job data | New `GET /api/v1/da/report-7day` (same shape as WB's `report-7day`) |
| Goals | Wait ≤ 60m (M/C Down MTTW and Setup MTTW), Setup+Conv MTTR ≤ 60m, Util < 80% |
| Util threshold | 80% (not WB's 85%) |
| Trend goal lines | none for DA (no trend goals were asked for) |
| Slide | one page, same layout as WB; uses DA's own goals and threshold |

## 2. Backend (done)
- `WbRepo::query_shift_metrics(op, ...)` takes the operation code. WB passes `"WB"`; its SQL is unchanged (verified line-by-line).
- `report_7day` split into `report_7day_for(op, ...)`; WB wrapper passes `"WB"`.
- `DaRepo::report_7day` → `report_7day_for("DA", ...)`; handler `get_report_7day`; route `/da/report-7day`.
- **Not yet verified against a live database** (the running API on :8090 is an older build; see the backend notes).

## 3. Frontend changes

### 3a. Make the trend components endpoint-aware
`SevenDayTrend.svelte` and `JobTrend.svelte` hard-code `/api/v1/wb/report-7day`. Add an optional `endpoint` prop (default = WB URL) so DA passes `/api/v1/da/report-7day`. WB behaviour is unchanged by default.

### 3b. Goals: separate DA config
`src/lib/config/da_goals.ts` (new), same shape as `wb_goals.ts`:
- `waitMin: 60`, `setupMin: 60`, `utilLowPct: 80`
- Reuses `goalDelta()` from `wb_goals.ts` (move the generic function to a shared file so DA and WB use one implementation).

### 3c. DA page (`src/routes/da-report/+page.svelte`)
- Add the PPTX button next to "↓ HTML Report" (same styling/disabled rule as WB).
- Capture the two trend payloads via `onLoaded` (same as WB).
- Build `PptxReportData` from DA's own values; `n_low` is computed from DA's `machines` at 80% (not from the API's 85%).
- Goal chips on the Wait and Setup+Conv cards using `da_goals.ts`.

### 3d. Slide code (`src/lib/utils/exportPptx.ts`)
- `exportWbReportPptx` is WB-named; generalise the title/heading via `PptxReportData.reportTitle` (e.g. "Die Attach — Daily Utilization & Downtime") and the Util threshold via `data.utilLowPct` (default 85 for WB, 80 for DA).
- Shift-loss card for DA: DA has no separate Idle card in its own page, so use the four cards it has (Down, Wait, Setup+Conv, SBO). The slide layout keeps five slots; a 4-card DA layout is fine, OR keep Idle if DA's page shows it. **To confirm with the user.**
- Event Pattern: DA's heatmap rows are `down`, `setup`, `sbo`. The slide shows M/C DOWN and SETUP+CONV only (same rule as WB), so `sbo` is filtered the same way.
- Top 3 panel: uses the same symptom aggregation, fed from DA machines (`top3DownSymptoms` exists in the WB page; DA page gets the same function).

## 4. Verification
1. `npm run check`: no new errors in changed files.
2. `vite build` passes.
3. Build-level: `buildTrendRows` / `buildJobRows` / `buildJobKpi` / `trimTrendToShift` reused unchanged (already tested).
4. Slide geometry test (node + python-pptx) as done for WB: no shapes outside the slide, table above footer, cards not overlapping charts.
5. **Live** (needs the running backend restarted with the new build): call `/api/v1/da/report-7day`, check response keys match WB's, check a DA shift value against the DA page.

## 5. Open questions
1. DA's loss row: four cards (Down, Wait, Setup+Conv, SBO) or five with Idle? (Idle exists in DA's page only as part of SBO; no separate card in DA's HTML export.)
2. The DA page's `n_low` at 80% vs the API's 85%: confirm 80% is the rule the business wants (the DA page already uses 80).
3. The running backend (PID 3820, :8090) must be restarted before the live test.
