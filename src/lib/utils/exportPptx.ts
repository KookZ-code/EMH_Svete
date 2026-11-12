// src/lib/utils/exportPptx.ts — WB daily report as a single 16:9 slide for presenting.
//
// Receives already-computed values from the wb-report page and builds one slide with native
// PowerPoint charts, so the presenter can still edit them. pptxgenjs is imported dynamically,
// so it is only downloaded when the button is pressed.

// Shape of /api/v1/wb/report-7day → data, as used by SevenDayTrend and JobTrend.
export interface WbTrendPayload {
  dates: string[];
  shifts: string[];
  metrics: { avg_util: number[]; down_pct: number[]; wait_pct: number[]; setup_conv_pct: number[]; idle_pct: number[] };
  shift_details: {
    date: string; shift: string; tech_count: number;
    request_down_jobs: number; request_setup_jobs: number; down_jobs: number; setup_jobs: number;
  }[];
}

export interface PptxKpi {
  total: number; n_down: number; avg_util: number; n_low: number; n_tech: number;
}

// Delta vs 7-day average. Undefined when no 7-day data is loaded.
export interface PptxKpiDelta { n_down?: number; avg_util?: number; n_low?: number; }

// Pass/fail badge against a goal, e.g. "+88m" (over, red) or "−10m" (within, green).
export interface PptxGoalChip { text: string; ok: boolean; }

// One detail line on a loss card. At the right end it can show a goal chip, or a short value
// (for example "103ev  1h 20m" on the Idle card), but not both.
// `delta` is a coloured "(+63 ev)" shown right after `text` (more events than the 7-day average = red),
// and `tail` is plain text after it, e.g. " · MTTR 22m".
export interface PptxLossLine { text: string; chip?: PptxGoalChip | null; right?: string; delta?: PptxGoalChip | null; tail?: string; }

export interface PptxLossCard {
  label: string; pct: number; color: string; lines: PptxLossLine[]; goalText?: string; total: string;
}

// Card above the trend chart: an average compared with its goal ("—" and no chip when there is no data).
export interface PptxGoalCard { label: string; value: string; goalText: string; chip: PptxGoalChip | null; }

// One row per shift, 7 days, same order as the trend chart.
export interface PptxTrendRow {
  label: string; down: number; wait: number; setup: number; idle: number; techs: number;
}

// One row per shift: total requests, total closed, and close rate (null when no request).
export interface PptxJobRow {
  label: string; req: number; close: number; rate: number | null;
}

// Values of the latest shift in the job chart (the rightmost pair), shown as the KPI cards above it.
export interface PptxJobKpi {
  label: string; req: number; close: number; closeRate: number | null; backlog: number;
}

// `state` is machines in that state per hour; empty for rows that only count events.
export interface PptxHeatRow { label: string; rgb: string; ev: number[]; state: number[]; total: string; }

// One symptom in the M/C DOWN top-3 panel: total down minutes for that symptom this shift, and how many
// events it caused.
// `pkg` is the package with the most down time on this symptom ("" when unknown).
// `pkgPct` is that package's share of this symptom's events, in percent (null when unknown).
export interface PptxTopSymptom { symptom: string; minutes: number; count: number; pkg: string; pkgPct: number | null; }

// Goal lines drawn on the two trend charts, in percent. Values come from WB_GOALS on the page.
export interface PptxTrendGoals { waitPct: number; closeRatePct: number; }

export interface PptxReportData {
  reportTitle: string;    // header title, e.g. "Wire Bond — Daily Utilization & Downtime"
  shiftLabel: string;     // "Night Shift"
  subtitle: string;       // "10 Nov 2026 · 19:00–07:00"
  packageLine: string;    // "Package: All Lead · 84 machines"
  kpi: PptxKpi;
  kpiDelta: PptxKpiDelta;
  loss: PptxLossCard[];
  goals: PptxGoalCard[];
  trend: PptxTrendRow[];
  jobs: PptxJobRow[];
  jobKpi: PptxJobKpi | null;
  heatHours: number[];    // shift hours, e.g. [19..6]
  heatRows: PptxHeatRow[];
  top3Down: PptxTopSymptom[];
  /** Goal lines for the trend charts. Omit when a report has none (DA); the lines are then not drawn. */
  trendGoals?: PptxTrendGoals | null;
  generatedAt: string;
}

// pptxgenjs' published typings declare addChart(type, data, options) and type `values` as number[].
// At runtime a combo chart takes its shared options as the second argument (makeChartType reads
// `data || opt`), and a null value is written as an empty point, which shows as a gap.
// These local types state that runtime contract once, so the rest of the file needs no `any`.
interface ComboPart {
  type: 'bar' | 'line';
  data: { name: string; labels: string[]; values: number[] }[];
  options?: Record<string, unknown>;
}
// Each axis list has one entry per axis. A second valAxes entry creates the right-hand axis;
// pptxgenjs only writes the secondary axis when valAxes has two entries (makeChartType).
interface AxisOpts { valAxisTitle?: string; valAxisMinVal?: number; valAxisMaxVal?: number; valAxisLabelFormatCode?: string; showValAxisTitle?: boolean; valAxisLabelPos?: 'high' | 'low' | 'nextTo' | 'none' }
interface ComboSlide {
  addChart(parts: ComboPart[], shared: Record<string, unknown> & { valAxes?: AxisOpts[]; catAxes?: { catAxisHidden?: boolean }[] }): unknown;
}

// Colours mirror the wb-report page (JOB_COLOR and the trend series). Keep in sync when those change.
const C = {
  primary: '1C355E', down: 'CC0000', wait: 'E67E22', setup: '1D9CE4', idle: '702076',
  rate: '2D8E4E', util: 'FD7F20', techs: 'D6DCE8', text: '2C2C2B', muted: '838E93',
  surface: 'F8F8F7', border: 'E3E3E3', good: '2E7D32', bad: 'C62828',
};
const FONT = 'Open Sans';
const SLIDE_W = 13.333, SLIDE_H = 7.5;   // LAYOUT_WIDE, inches
const MARGIN = 0.4, CARD_GAP = 0.15, GAP = 0.2;
// Fleet KPI row: five cards. Loss row: five cards on the same width.
const KPI_COLS = 5, KPI_W = (SLIDE_W - MARGIN * 2 - CARD_GAP * (KPI_COLS - 1)) / KPI_COLS;
// Vertical layout in inches. One top row of five cards (Down, Wait, Setup+Conv, SBO, Idle) so the
// charts below get most of the height. The fleet numbers (machines, util, down, low-util, techs) are
// drawn as a single line in the header instead of a card row.
const STRIP_Y = 0.86, STRIP_H = 0.22;   // fleet summary line under the header
const LOSS_Y = 1.14, LOSS_H = 1.1;
const CHART_CARD_H = 0.5;                 // cards above each chart (goal cards left, job cards right)
const EVENT_ROWS = 5;                     // header + (events, in state) x 2 categories
const EVENT_ROW_H = 0.2;
const PANEL_W = 3.6, PANEL_X = SLIDE_W - MARGIN - PANEL_W;   // Top 3 M/C Down panel, right of the event table
const FOOTER_Y = SLIDE_H - 0.26;
// Event Pattern is anchored to the footer: its title, then the table, end just above it.
const BOT_Y = FOOTER_Y - 0.05 - EVENT_ROWS * EVENT_ROW_H - 0.26;

// "Day Shift" tag used on the x axis, e.g. "15 N" — same label as the page's trend charts.
function shiftTag(date: string, shift: string): string {
  return `${date.split('-')[2]} ${shift.slice(0, 1)}`;
}

// The 7-day API payload ends at "now", so it can include a shift newer than the one the report is for
// (for example the Day shift that just started while the report is for last night). The slide must end at
// the reported shift, otherwise the charts and the "latest shift" cards show a half-finished shift.
// Returns the payload cut after the (date, shift) entry; unchanged when that entry is not in the data.
export function trimTrendToShift(t: WbTrendPayload, date: string, shift: string): WbTrendPayload {
  let last = -1;
  t.dates.forEach((d, i) => { if (d === date && t.shifts[i] === shift) last = i; });
  if (last < 0 || last === t.dates.length - 1) return t;
  const keep = new Set(t.dates.slice(0, last + 1).map((d, i) => `${d}|${t.shifts[i]}`));
  const cut = <T,>(arr: T[]) => arr.slice(0, last + 1);
  return {
    dates: cut(t.dates),
    shifts: cut(t.shifts),
    metrics: {
      avg_util: cut(t.metrics.avg_util), down_pct: cut(t.metrics.down_pct), wait_pct: cut(t.metrics.wait_pct),
      setup_conv_pct: cut(t.metrics.setup_conv_pct), idle_pct: cut(t.metrics.idle_pct),
    },
    shift_details: t.shift_details.filter((d) => keep.has(`${d.date}|${d.shift}`)),
  };
}

// Converts the 7-day API payload into the trend rows the slide draws.
// Technician count is looked up per (date, shift), as the SevenDayTrend component does.
export function buildTrendRows(t: WbTrendPayload): PptxTrendRow[] {
  const techBy = new Map(t.shift_details.map((d) => [`${d.date}|${d.shift}`, d.tech_count]));
  return t.dates.map((date, i) => {
    const shift = t.shifts[i];
    return {
      label: shiftTag(date, shift),
      down: t.metrics.down_pct[i] ?? 0,
      wait: t.metrics.wait_pct[i] ?? 0,
      setup: t.metrics.setup_conv_pct[i] ?? 0,
      idle: t.metrics.idle_pct[i] ?? 0,
      techs: techBy.get(`${date}|${shift}`) ?? 0,
    };
  });
}

// Converts the 7-day payload into request/close rows. Close rate is null when there is no request,
// matching JobTrend.svelte, so the chart leaves a gap for that shift.
export function buildJobRows(t: WbTrendPayload): PptxJobRow[] {
  return t.shift_details.map((d) => {
    const req = d.request_down_jobs + d.request_setup_jobs;
    const close = d.down_jobs + d.setup_jobs;
    return {
      label: shiftTag(d.date, d.shift),
      req,
      close,
      rate: req > 0 ? Math.round((close / req) * 1000) / 10 : null,
    };
  });
}

// Values of the latest shift (last row, since the trend runs oldest to newest).
// Remain is request minus close for that shift (the same value JobTrend.svelte shows as Remain).
// Returns null when there are no rows.
export function buildJobKpi(rows: PptxJobRow[]): PptxJobKpi | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  return {
    label: last.label,
    req: last.req,
    close: last.close,
    closeRate: last.rate,
    backlog: last.req - last.close,
  };
}

// Minutes as "1h 20m" / "45m", the same format as the web report.
function fmtMinutes(m: number): string {
  const v = Math.round(m);
  return v >= 60 ? `${Math.floor(v / 60)}h ${v % 60}m` : `${v}m`;
}

// "+1.4%" / "-2" style delta. Returns '' when there is nothing to show.
function fmtDelta(v: number | undefined, suffix = ''): string {
  if (v == null) return '';
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? '+' : ''}${r}${suffix}`;
}

// Delta text plus whether it is good. higherIsBetter flips the colour rule for the metric.
function deltaChip(v: number | undefined, suffix: string, higherIsBetter: boolean): { text: string; ok: boolean } | null {
  if (v == null || v === 0) return null;
  return { text: fmtDelta(v, suffix), ok: higherIsBetter ? v > 0 : v < 0 };
}

// Mixes a hex colour with white at `alpha`, matching the page's rgba() heatmap cells.
function blendWithWhite(hex: string, alpha: number): string {
  const n = parseInt(hex, 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * alpha + 255 * (1 - alpha))
    .toString(16).padStart(2, '0');
  return (ch(16) + ch(8) + ch(0)).toUpperCase();
}

// Heatmap rows arrive as "r,g,b" decimal strings from the page; convert once to hex.
function rgbCsvToHex(csv: string): string {
  return csv.split(',').map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function heatCell(v: number, max: number, hex: string) {
  const alpha = max > 0 ? (v / max) * 0.88 + 0.08 : 0.08;
  return {
    text: v ? String(v) : '',
    options: {
      fill: { color: blendWithWhite(hex, alpha) },
      color: alpha > 0.5 ? 'FFFFFF' : C.text,
      bold: true, align: 'center' as const, fontSize: 9,
    },
  };
}

// Draws one small card: a colour bar on the left, label on top, value below, an optional delta badge
// on the right and an optional small line at the bottom (used for "goal ≤ 60m").
// Used for the fleet row, the goal cards and the job cards, so they all look the same.
function drawKpiCard(
  slide: { addShape: Function; addText: Function },
  pptx: { ShapeType: { rect: string } },
  x: number, y: number, w: number, h: number,
  card: { label: string; value: string; color: string; size: number; delta?: string; good?: boolean; sub?: string },
) {
  const BADGE_W = 0.56;
  // Value never runs under the delta badge; without a badge it can use the full width,
  // so narrow cards (the job row) do not wrap a number like "3,910" onto two lines.
  const valueW = card.delta ? w - BADGE_W - 0.3 : w - 0.25;
  const subH = card.sub ? 0.15 : 0;
  const labelH = 0.17;
  const valueY = y + 0.03 + labelH;
  const valueH = y + h - valueY - subH - 0.02;
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: C.surface }, line: { color: C.border, width: 0.75 } });
  slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.05, h, fill: { color: card.color }, line: { type: 'none' } });
  slide.addText(card.label, { x: x + 0.12, y: y + 0.03, w: w - 0.2, h: labelH, fontFace: FONT, fontSize: 8, bold: true, color: C.text, valign: 'middle', margin: 0, fit: 'shrink' });
  slide.addText(card.value, { x: x + 0.12, y: valueY, w: valueW, h: valueH, fontFace: FONT, fontSize: card.size, bold: true, color: card.color, valign: 'middle', margin: 0 });
  if (card.delta) {
    slide.addText(card.delta, {
      x: x + w - BADGE_W - 0.08, y: valueY + (valueH - 0.2) / 2, w: BADGE_W, h: 0.2, fontFace: FONT, fontSize: 8, bold: true, align: 'center', valign: 'middle', margin: 0,
      color: card.good ? C.good : C.bad,
      fill: { color: card.good ? 'E8F5E9' : 'FFEBEE' },
    });
  }
  if (card.sub) {
    slide.addText(card.sub, { x: x + 0.12, y: y + h - subH - 0.02, w: w - 0.2, h: subH, fontFace: FONT, fontSize: 7, color: C.muted, valign: 'middle', margin: 0 });
  }
}

// Small rounded pill with a dot and the delta text, e.g. "● +88m". Green when within goal, red when over.
function drawGoalChip(slide: { addText: Function }, chip: PptxGoalChip, x: number, y: number, w = 0.58, h = 0.14) {
  slide.addText(`● ${chip.text}`, {
    x, y, w, h, fontFace: FONT, fontSize: 7, bold: true, align: 'center', valign: 'middle', margin: 0,
    color: chip.ok ? C.good : C.bad, fill: { color: chip.ok ? 'E8F5E9' : 'FFEBEE' }, rectRadius: 0.08,
  });
}

// Builds the single-slide deck and downloads it. Returns the file name used.
export async function exportReportPptx(data: PptxReportData, fileName: string): Promise<string> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = fileName;
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  const combo = slide as unknown as ComboSlide;

  // ── Header bar ────────────────────────────────────────────────────────────
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: 0.8, fill: { color: C.primary }, line: { type: 'none' } });
  slide.addText(data.reportTitle, {
    x: MARGIN, y: 0.1, w: 8, h: 0.6, fontFace: FONT, fontSize: 24, bold: true, color: 'FFFFFF', valign: 'middle',
  });
  slide.addText([
    { text: `${data.shiftLabel}  ·  ${data.subtitle}`, options: { breakLine: true, bold: true } },
    { text: data.packageLine },
  ], { x: 7.6, y: 0.08, w: 5.33, h: 0.64, fontFace: FONT, fontSize: 12, color: 'FFFFFF', align: 'right', valign: 'middle' });

  // ── Fleet summary strip: machines, util, down, low-util, techs as plain text under the header ───
  const fleetParts: { text: string; color: string; delta?: { text: string; ok: boolean } | null }[] = [
    { text: `Machines ${data.kpi.total}`, color: C.text },
    { text: `Avg Util ${data.kpi.avg_util}%`, color: C.util, delta: deltaChip(data.kpiDelta.avg_util, '%', true) },
    { text: `M/C Down ${data.kpi.n_down}`, color: C.down, delta: deltaChip(data.kpiDelta.n_down, '', false) },
    { text: `Util < 85% ${data.kpi.n_low}`, color: C.down, delta: deltaChip(data.kpiDelta.n_low, '', false) },
    { text: `Techs ${data.kpi.n_tech}`, color: '702076' },
  ];
  const runs: { text: string; options: Record<string, unknown> }[] = [];
  fleetParts.forEach((p, i) => {
    if (i > 0) runs.push({ text: '     ', options: { color: C.muted } });
    runs.push({ text: p.text, options: { color: p.color, bold: true } });
    if (p.delta) runs.push({ text: ` (${p.delta.text} vs 7d)`, options: { color: p.delta.ok ? C.good : C.bad, bold: true } });
  });
  slide.addText(runs, { x: MARGIN, y: STRIP_Y, w: SLIDE_W - MARGIN * 2, h: STRIP_H, fontFace: FONT, fontSize: 11, margin: 0, valign: 'middle' });

  // ── Shift loss row: pct, name (+ goal), detail lines (+ goal chips), total ─
  data.loss.forEach((l, i) => {
    const x = MARGIN + i * (KPI_W + CARD_GAP);
    const innerW = KPI_W - 0.24;
    const T = { fontFace: FONT, valign: 'middle' as const, margin: 0 };
    slide.addShape(pptx.ShapeType.rect, { x, y: LOSS_Y, w: KPI_W, h: LOSS_H, fill: { color: 'FFFFFF' }, line: { color: C.border, width: 0.75 } });
    slide.addShape(pptx.ShapeType.rect, { x, y: LOSS_Y, w: KPI_W, h: 0.05, fill: { color: l.color }, line: { type: 'none' } });
    // % on the left and Total on the right of one row, so up to three detail lines fit below the name.
    slide.addText(`${l.pct}%`, { ...T, x: x + 0.12, y: LOSS_Y + 0.07, w: innerW * 0.38, h: 0.3, fontSize: 18, bold: true, color: l.color });
    slide.addText(l.total, { ...T, x: x + 0.12 + innerW * 0.4, y: LOSS_Y + 0.07, w: innerW * 0.6, h: 0.3, fontSize: 8, bold: true, color: l.color, align: 'right' });
    slide.addText(l.label.toUpperCase(), { ...T, x: x + 0.12, y: LOSS_Y + 0.37, w: l.goalText ? innerW - 0.7 : innerW, h: 0.16, fontSize: 8, bold: true, color: C.text });
    if (l.goalText) {
      slide.addText(l.goalText, { ...T, x: x + 0.12 + innerW - 0.66, y: LOSS_Y + 0.37, w: 0.66, h: 0.16, fontSize: 7, color: C.muted, align: 'right' });
    }
    l.lines.forEach((line, k) => {
      const ly = LOSS_Y + 0.54 + k * 0.145;
      const sideW = line.chip ? 0.58 : line.right ? 0.82 : 0;     // room kept free at the right end of the line
      // Plain line, or text runs when the line has an inline event delta so only the delta is coloured.
      const lineBox = { ...T, x: x + 0.12, y: ly, w: innerW - (sideW ? sideW + 0.04 : 0), h: 0.14, fontSize: 7, color: C.muted, fit: 'shrink' as const };
      if (line.delta || line.tail) {
        slide.addText([
          { text: line.text, options: { color: C.muted } },
          ...(line.delta ? [{ text: ` ${line.delta.text}`, options: { color: line.delta.ok ? C.good : C.bad, bold: true } }] : []),
          ...(line.tail ? [{ text: line.tail, options: { color: C.muted } }] : []),
        ], lineBox);
      } else {
        slide.addText(line.text, lineBox);
      }
      if (line.chip) drawGoalChip(slide, line.chip, x + 0.12 + innerW - sideW, ly, sideW, 0.14);
      if (line.right) {
        slide.addText(line.right, { ...T, x: x + 0.12 + innerW - sideW, y: ly, w: sideW, h: 0.14, fontSize: 7, bold: true, color: l.color, align: 'right' });
      }
    });
  });

  // ── Middle row: two trend charts, 50/50 ───────────────────────────────────
  const midY = LOSS_Y + LOSS_H + 0.08, midH = BOT_Y - 0.06 - midY, halfW = (SLIDE_W - MARGIN * 2 - GAP) / 2;
  const jobX = MARGIN + halfW + GAP;
  const cardsY = midY + 0.25;
  const chartY = cardsY + CHART_CARD_H + 0.03, chartH = midH - (chartY - midY);
  // Shared chart options, read from the second argument in combo mode.
  const sharedChart = {
    fontFace: FONT, fontSize: 9, showLegend: true, legendPos: 'b', legendFontSize: 9,
    catAxisLabelFontSize: 8, catAxisLabelRotate: 0, valAxisLabelFontSize: 9, valAxisMinVal: 0,
  };

  slide.addText('Trend — Utilization / Loss (%) & Technicians', {
    x: MARGIN, y: midY, w: halfW, h: 0.24, fontFace: FONT, fontSize: 10, bold: true, color: C.primary, margin: 0,
  });
  // Three goal cards above the trend chart: each average with its goal and a pass/fail chip.
  const goalCardW = (halfW - CARD_GAP * 2) / 3;
  data.goals.forEach((g, i) => {
    drawKpiCard(slide, pptx, MARGIN + i * (goalCardW + CARD_GAP), cardsY, goalCardW, CHART_CARD_H, {
      label: g.label, value: g.value, size: 14, sub: g.goalText,
      color: !g.chip ? C.muted : g.chip.ok ? C.good : C.bad,
      delta: g.chip?.text, good: g.chip?.ok,
    });
  });
  const trendLabels = data.trend.map((r) => r.label);
  // Technicians (bars, light fill) are listed first so the % lines draw on top.
  combo.addChart([
    { type: 'bar',
      data: [{ name: 'Technicians', labels: trendLabels, values: data.trend.map((r) => r.techs) }],
      options: { chartColors: [C.techs], barGapWidthPct: 60, secondaryValAxis: true, secondaryCatAxis: true } },
    { type: 'line',
      data: [
        { name: 'M/C DOWN %', labels: trendLabels, values: data.trend.map((r) => r.down) },
        { name: 'WAIT %', labels: trendLabels, values: data.trend.map((r) => r.wait) },
        { name: 'SETUP+CONV %', labels: trendLabels, values: data.trend.map((r) => r.setup) },
        { name: 'IDLE %', labels: trendLabels, values: data.trend.map((r) => r.idle) },
      ],
      options: { chartColors: [C.down, C.wait, C.setup, C.idle], lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 6 } },
    // Goal line: dashed, no markers, its own line group because pptxgenjs sets dash per group.
    // Omitted entirely when the report has no goal (DA), so the chart has no empty series.
    ...(data.trendGoals ? [{ type: 'line' as const,
      data: [{ name: `WAIT goal ${data.trendGoals.waitPct}%`, labels: trendLabels, values: trendLabels.map(() => data.trendGoals!.waitPct) }],
      options: { chartColors: [C.wait], lineSize: 1.5, lineDash: 'dash', lineDataSymbol: 'none' } }] : []),
  ], {
    ...sharedChart, x: MARGIN, y: chartY, w: halfW, h: chartH,
    valAxes: [
      { showValAxisTitle: true, valAxisTitle: '% OF SHIFT', valAxisMinVal: 0, valAxisLabelFormatCode: '0' },
      { showValAxisTitle: true, valAxisTitle: 'TECHNICIANS', valAxisMinVal: 0, valAxisLabelFormatCode: '0', valAxisLabelPos: 'high' },
    ],
    catAxes: [{}, { catAxisHidden: true }],
  });

  // ── Job Request / Close: latest-shift KPI cards above the chart ───────────
  // Cards show the newest shift only, so they match the rightmost bars the presenter is looking at.
  const jk = data.jobKpi;
  const jobTitle = jk ? `Job Request / Close  ·  latest shift ${jk.label}` : 'Job Request / Close';
  slide.addText(jobTitle, {
    x: jobX, y: midY, w: halfW, h: 0.24, fontFace: FONT, fontSize: 10, bold: true, color: C.primary, margin: 0,
  });
  if (jk) {
    const jobCards = [
      { label: 'Request', value: jk.req.toLocaleString(), color: C.primary },
      { label: 'Close', value: jk.close.toLocaleString(), color: C.setup },
      { label: 'Close Rate', value: jk.closeRate == null ? '-' : `${jk.closeRate.toFixed(1)}%`, color: C.rate },
      { label: 'Remain', value: jk.backlog.toLocaleString(), color: '702076' },
    ];
    const jobCardW = (halfW - CARD_GAP * 3) / 4;
    jobCards.forEach((k, i) => {
      drawKpiCard(slide, pptx, jobX + i * (jobCardW + CARD_GAP), cardsY, jobCardW, CHART_CARD_H, { ...k, size: 14 });
    });
  }

  const jobLabels = data.jobs.map((r) => r.label);
  combo.addChart([
    { type: 'bar',
      data: [
        { name: 'Request', labels: jobLabels, values: data.jobs.map((r) => r.req) },
        { name: 'Close', labels: jobLabels, values: data.jobs.map((r) => r.close) },
      ],
      options: { chartColors: [C.primary, C.setup], barGapWidthPct: 50 } },
    { type: 'line',
      data: [{ name: 'Close Rate %', labels: jobLabels, values: gapValues(data.jobs.map((r) => r.rate)) }],
      options: { chartColors: [C.rate], lineSize: 2, lineDataSymbol: 'diamond', secondaryValAxis: true, secondaryCatAxis: true } },
    // Close-rate goal: dashed, on the same right-hand percent axis as the close rate it is judged against.
    ...(data.trendGoals ? [{ type: 'line' as const,
      data: [{ name: `Close rate goal ${data.trendGoals.closeRatePct}%`, labels: jobLabels, values: jobLabels.map(() => data.trendGoals!.closeRatePct) }],
      options: { chartColors: [C.rate], lineSize: 1.5, lineDash: 'dash', lineDataSymbol: 'none', secondaryValAxis: true, secondaryCatAxis: true } }] : []),
  ], {
    ...sharedChart, x: jobX, y: chartY, w: halfW, h: chartH, displayBlanksAs: 'gap',
    valAxes: [
      { showValAxisTitle: true, valAxisTitle: 'JOBS', valAxisMinVal: 0 },
      { showValAxisTitle: true, valAxisTitle: 'CLOSE RATE %', valAxisMinVal: 0, valAxisMaxVal: 100, valAxisLabelFormatCode: '0"%"' },
    ],
    catAxes: [{}, { catAxisHidden: true }],
  });

  // ── Bottom row: Event Pattern on the left, Top 3 M/C DOWN on the right ───
  const botY = BOT_Y;
  slide.addText('Event Pattern — Hourly (events started)', {
    x: MARGIN, y: botY, w: SLIDE_W - MARGIN * 2, h: 0.24, fontFace: FONT, fontSize: 10, bold: true, color: C.primary, margin: 0,
  });

  const headerRow = [
    { text: '', options: {} },
    ...data.heatHours.map((h) => ({ text: String(h).padStart(2, '0'), options: { bold: true, align: 'center' as const, color: C.muted, fontSize: 8 } })),
    { text: 'TOTAL', options: { bold: true, align: 'right' as const, color: C.muted, fontSize: 8 } },
  ];
  const tableRows: { text: string; options: Record<string, unknown> }[][] = [headerRow];
  // Each category gets an events row; categories with machine-state counts also get an "in state" row
  // (how many machines were in that state during the hour), matching the page's heatmap.
  for (const r of data.heatRows) {
    const max = Math.max(...r.ev, 1);
    const hex = rgbCsvToHex(r.rgb);
    tableRows.push([
      { text: r.label, options: { bold: true, fontSize: 9, color: C.text } },
      ...r.ev.map((v) => heatCell(v, max, hex)),
      { text: r.total, options: { bold: true, align: 'right' as const, color: hex, fontSize: 9 } },
    ]);
    if (r.state.length > 0) {
      const stMax = Math.max(...r.state, 1);
      tableRows.push([
        { text: `${r.label} in state`, options: { italic: true, fontSize: 8, color: C.muted } },
        ...r.state.map((v) => heatCell(v, stMax, hex)),
        { text: `peak ${Math.max(...r.state, 0)}`, options: { italic: true, align: 'right' as const, color: hex, fontSize: 8 } },
      ]);
    }
  }
  const heatW = PANEL_X - MARGIN - GAP, LABEL_COL = 1.45, TOTAL_COL = 0.85;
  const hourColW = (heatW - LABEL_COL - TOTAL_COL) / data.heatHours.length;
  slide.addTable(tableRows, {
    x: MARGIN, y: botY + 0.28, w: heatW,
    colW: [LABEL_COL, ...data.heatHours.map(() => hourColW), TOTAL_COL],
    // PowerPoint stretches a row to fit its text plus the cell margin, so the margin is set to 0 here;
    // otherwise the default margin makes every row taller than EVENT_ROW_H and the table runs into the footer.
    fontFace: FONT, border: { type: 'none' }, rowH: EVENT_ROW_H, margin: 0, valign: 'middle',
  });

  // ── Top 3 M/C DOWN panel: symptoms with the most down time this shift ────
  // Right of the Event Pattern table. Each row: rank, symptom, total minutes, and the event count.
  const PANEL_TITLE_Y = botY;
  slide.addText('Top 3 M/C Down symptoms  ·  total down time', {
    x: PANEL_X, y: PANEL_TITLE_Y, w: PANEL_W, h: 0.24, fontFace: FONT, fontSize: 10, bold: true, color: C.down, margin: 0,
  });
  const panelBoxY = botY + 0.28, panelBoxH = EVENT_ROWS * EVENT_ROW_H;
  slide.addShape(pptx.ShapeType.rect, { x: PANEL_X, y: panelBoxY, w: PANEL_W, h: panelBoxH, fill: { color: C.surface }, line: { color: C.border, width: 0.75 } });
  slide.addShape(pptx.ShapeType.rect, { x: PANEL_X, y: panelBoxY, w: 0.05, h: panelBoxH, fill: { color: C.down }, line: { type: 'none' } });
  if (data.top3Down.length === 0) {
    slide.addText('No M/C Down this shift', { x: PANEL_X + 0.15, y: panelBoxY, w: PANEL_W - 0.2, h: panelBoxH, fontFace: FONT, fontSize: 9, color: C.muted, valign: 'middle', margin: 0 });
  }
  // Each machine is two full-width lines: "#1  W/B # 506R .......... 4h 50m" and "cause · package".
  // Full width plus shrink-to-fit keeps long package names on one line instead of pushing into the next row.
  const T = { fontFace: FONT, valign: 'middle' as const, margin: 0 };
  data.top3Down.forEach((m, i) => {
    const ry = panelBoxY + 0.05 + i * 0.3;
    slide.addText(`#${i + 1}  ${m.symptom}`, { ...T, x: PANEL_X + 0.15, y: ry, w: PANEL_W - 1.0, h: 0.15, fontSize: 9, bold: true, color: C.primary, fit: 'shrink' });
    slide.addText(fmtMinutes(m.minutes), { ...T, x: PANEL_X + PANEL_W - 0.95, y: ry, w: 0.82, h: 0.15, fontSize: 9, bold: true, color: C.down, align: 'right' });
    // Second line: event count, then the top package for this symptom. Shrinks rather than wrapping.
    const share = m.pkg && m.pkgPct != null ? `${m.pkg} (${m.pkgPct}%)` : m.pkg;
    const detail = share ? `${m.count} events  ·  ${share}` : `${m.count} events`;
    slide.addText(detail, { ...T, x: PANEL_X + 0.15, y: ry + 0.155, w: PANEL_W - 0.25, h: 0.13, fontSize: 7, color: C.muted, fit: 'shrink' });
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  slide.addText(`Source: EMH Dashboard · WB Report  ·  Generated ${data.generatedAt}`, {
    x: MARGIN, y: FOOTER_Y, w: SLIDE_W - MARGIN * 2, h: 0.2, fontFace: FONT, fontSize: 8, color: C.muted, margin: 0,
  });

  await pptx.writeFile({ fileName });
  return fileName;
}

// The one place a null rate crosses into `number[]` (see ComboPart). Kept as a function so the
// reason is written down once.
function gapValues(values: (number | null)[]): number[] {
  return values as number[];
}

/** WB entry point kept for existing callers; the slide itself is shared with DA. */
export function exportWbReportPptx(data: PptxReportData, fileName: string): Promise<string> {
  return exportReportPptx(data, fileName);
}
