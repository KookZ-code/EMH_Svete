# Plan: WB-Report 7-Day Trend — chart format revamp

Target: `src/lib/components/SevenDayTrend.svelte` (used by `src/routes/wb-report/+page.svelte:1199`)
Reference: `downtime_trend_dashboard.html` (Chart.js 4.4.1, dark theme)

## 1. Findings

### Reference format (what to borrow)
| Aspect | Reference |
|---|---|
| Layout | 2-column: **Series Control** panel (250px, left) + chart panel (right) |
| Panel header | Title left, small hint "HOVER FOR VALUES" right |
| Series toggles | Vertical list, each row = switch + color swatch + label; grouped (Counts / Rate / Duration) |
| Axis note | Line under header explaining LEFT / RIGHT axis meaning |
| Lines | width 2, `tension 0.3` (smooth), point r=3, hover r=5, `spanGaps` |
| Legend | Hidden (toggle panel replaces it) |
| Interaction | `mode: index, intersect: false` — one tooltip lists all series at the hovered x |
| Tooltip | Bordered box, colored title, 11px, padding 10 |
| Grid / ticks | Very faint grid, 10px muted ticks, 9px muted axis titles |
| Axes | Left + right axis, grid only on left |
| KPI | Strip of tiles above the chart |

### Current wb-report format
- ECharts (not Chart.js), top legend (AVG UTIL % greyed), pill toggle buttons above the table
- Single `%` axis, x labels rotated 45°, tooltip `axisPointer: shadow`
- Straight lines, point size 4, no axis title other than `%`
- Order: toggles → data table → chart → 5 summary tiles
- Colors/sizes hardcoded in the component (violates CLAUDE.md rules 6/10)

## 2. Key decisions (need confirmation — see §5)
1. **Keep ECharts**, do not add Chart.js (CLAUDE.md: keep deps lean; `EChart.svelte` already exists and is used elsewhere). All reference features have ECharts equivalents.
2. **Keep the light Microchip theme**, do not copy the dark palette (DESIGN.md is the single source of truth). Only the *structure/format* is borrowed.
3. Data stays the same (all 5 series are %, so **one Y axis** — no dual-axis needed here).

## 3. Changes

### A. Layout (`SevenDayTrend.svelte` markup + CSS)
1. Replace top pill toggles with a **Series Control** panel on the left (~220–250px, stacks above chart on narrow screens), rows = switch + swatch + label, order: AVG UTIL, M/C DOWN, WAIT, SETUP+CONV, IDLE.
2. Right panel header: "Trend — Utilization / Loss (%)" + "HOVER FOR VALUES" hint; one-line axis note ("Y axis — % of shift time").
3. Move the 5 "Avg …" summary tiles from below the chart to a **KPI strip above** the chart (same values; reuse `avgOf()` instead of the 4 repeated reduce expressions).
4. Keep the detail table below the chart (reference puts table last) — **moves table from above to below**.

### B. Chart options (`buildChart()`)
1. `legend` removed (toggle panel is the legend).
2. Series: `smooth: 0.3`, `lineStyle.width: 2`, `symbolSize: 6`, hover `emphasis` → size ~10.
3. Toggle via series data/`legendSelect`-free approach: build `series` only from enabled metrics (also fixes the current `show:` property, which is not an ECharts series option and does nothing).
4. Tooltip: `trigger: 'axis'`, `axisPointer: { type: 'line' }` (instead of shadow), bordered box, bold title `date shift`, rows with colored dot + `value%`; keep existing formatter logic.
5. Axes: faint grid lines on Y only, 10px muted tick labels, x labels `DD S` not rotated if width allows (else keep `rotate` only under a width threshold); Y name `%` → axis title "% OF SHIFT".
6. Keep dynamic `yMax` logic (it already works), but extract into a small named function `calcYMax()`.
7. Grid padding adjusted so the chart fills the panel (remove the empty bottom gap visible in the screenshot).

### C. Design tokens (CLAUDE.md rules 6 & 10)
1. Add metric colors + chart grid/tick/tooltip tokens to `src/app.css` `@theme` (series colors currently hardcoded: `#2d8e4e #cc0000 #e67e22 #1d9ce4 #702076` — **not in DESIGN.md**, so need confirmation).
2. ECharts can't read CSS vars directly in options → add a tiny `cssVar(name)` helper in `$lib/utils/` that reads `getComputedStyle`.
3. Replace hardcoded px/hex in the component CSS with tokens.

### D. Single source of metric config
One `METRICS` array `{key, label, color}` driving toggles, series, KPI tiles (today the list is duplicated 3×).

## 4. Verification
1. `npm run check` — no new errors.
2. Playwright MCP: open `/wb-report`, confirm (a) panel + chart render, (b) each toggle shows/hides its line and rescales Y, (c) tooltip shows all visible series, (d) KPI values equal the previous bottom tiles, (e) mobile width (~390px) stacks cleanly, (f) screenshot compare with reference layout.
3. Confirm table sorting still works after being moved.

## 5. Open questions
1. OK to keep ECharts + light theme (only copy layout/format)?
2. Should the series colors stay as-is (add them as tokens) or switch to DESIGN.md palette (`accent-orange`, `accent-blue`, `brand-red`, `accent-green`, `primary`)?
3. Table position: move below the chart (as in reference) or leave above?
4. Smooth lines (tension 0.3) as in the reference, or keep straight lines (more faithful for % data)?
