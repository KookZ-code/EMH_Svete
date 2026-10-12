<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import KpiCard from '$lib/components/KpiCard.svelte';
  import { overviewApi, downtimeApi } from '$lib/utils/api';
  import type { MachineArea, OverviewKpi, StatusMatrixRow, TopDowntimeMachineRow, MtbfPayload } from '$types';

  const ALL_AREAS: MachineArea[] = ['BG','SAW','DA','WB','MOLD','PLATE','MARK','SAW_QFN','TF','ISO','FS'];

  interface DowntimeKpi { total_hours: number; total_events: number; avg_repair_min: number; avg_wait_min: number; }
  interface ReasonRow { reason: string; hours: number; count: number; cumulative_pct: number; }

  // ── State ────────────────────────────────────────────────────────────────
  let loading      = $state(true);
  let error        = $state<string | null>(null);
  let filterAreas  = $state<MachineArea[]>([]);   // empty = all areas
  let lastUpdated  = $state('');

  let fleetKpi     = $state<OverviewKpi>({ key_machines:0, running:0, mc_down:0, waiting_for_tech:0, on_process:0, closed_this_shift:0, last_updated:'' });
  let statusMatrix = $state<StatusMatrixRow[]>([]);
  let downtimeKpi  = $state<DowntimeKpi>({ total_hours:0, total_events:0, avg_repair_min:0, avg_wait_min:0 });
  let mtbf         = $state<MtbfPayload>({ fleet_mtbf_hours:0, fleet_down_events:0, machines:[] });
  let topMachines  = $state<TopDowntimeMachineRow[]>([]);
  let topReasons   = $state<ReasonRow[]>([]);
  let processKpi   = $state<Record<MachineArea, OverviewKpi>>({} as Record<MachineArea, OverviewKpi>);

  // Last 30 days window — matches the wireframe's "30-day baseline" framing
  const range = (() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10) };
  })();

  function toggleArea(a: MachineArea) {
    if (filterAreas.includes(a)) filterAreas = filterAreas.filter(x => x !== a);
    else filterAreas = [...filterAreas, a];
    loadData();
  }

  async function loadData() {
    loading = true;
    error = null;
    const areas = filterAreas.length > 0 ? filterAreas : undefined;

    const [overviewRes, downtimeRes, mtbfRes, topRes] = await Promise.all([
      overviewApi.all(areas),
      downtimeApi.detail({ start: range.start, end: range.end, areas, job_types: ['M/C DOWN'] }),
      overviewApi.mtbf({ start: range.start, end: range.end, areas }),
      downtimeApi.topMachines({ start: range.start, end: range.end, areas, limit: 10 }),
    ]);

    if (overviewRes.error) { error = overviewRes.error.message; loading = false; return; }
    if (overviewRes.data) {
      fleetKpi = overviewRes.data.kpi;
      statusMatrix = overviewRes.data.matrix;
      lastUpdated = overviewRes.data.kpi.last_updated;
    }
    if (downtimeRes.data) {
      const d = downtimeRes.data as unknown as { kpi?: DowntimeKpi; reason?: ReasonRow[] };
      if (d.kpi) downtimeKpi = d.kpi;
      if (d.reason) topReasons = d.reason.slice(0, 6);
    }
    if (mtbfRes.data) mtbf = mtbfRes.data;
    if (topRes.data) topMachines = topRes.data.rows;

    // Per-process breakdown — 11 parallel calls, one per area (no server-side
    // group-by-area exists yet; see plan notes on this tradeoff).
    const perArea = await Promise.all(ALL_AREAS.map(a => overviewApi.all([a])));
    const next: Record<MachineArea, OverviewKpi> = {} as Record<MachineArea, OverviewKpi>;
    ALL_AREAS.forEach((a, i) => {
      const r = perArea[i];
      if (r.data) next[a] = r.data.kpi;
    });
    processKpi = next;

    loading = false;
  }

  // Color + display-order for every job type that can appear in the status
  // matrix — matches jobTypeColor() convention from the root Overview page so
  // the same job type always reads as the same color across pages.
  const JOB_TYPE_STYLE: Record<string, { color: string; label: string }> = {
    'M/C DOWN':          { color: 'var(--status-down)',      label: 'M/C Down' },
    'ENGINEERING DOWN':  { color: 'var(--status-eng-down)',  label: 'Eng. Down' },
    'FACILITY DOWN':     { color: 'var(--status-facility)',  label: 'Facility Down' },
    'SETUP':             { color: 'var(--status-setup)',     label: 'Setup' },
    'SETUP BY OPERATOR': { color: 'var(--status-waiting)',   label: 'Setup by Operator' },
    'CONVERT':           { color: 'var(--status-convert)',   label: 'Convert' },
    'CLEAN MOLD':        { color: 'var(--status-running)',   label: 'Clean Mold' },
    'CHANGE CAP':        { color: 'var(--status-other)',     label: 'Change Cap' },
    'PM':                { color: 'var(--status-pm)',        label: 'PM' },
  };
  const JOB_TYPE_ORDER = Object.keys(JOB_TYPE_STYLE);

  // Breakdown by job type for a given matrix column. SETUP BY OPERATOR never
  // has waiting/on_process (backend excludes it from those — operator
  // self-closed jobs never sit "open"), but it DOES close jobs and must be
  // included for the `closed` column — otherwise Completed Job's breakdown
  // undercounts against the pill's total (SETUP BY OPERATOR is often the
  // single largest source of closed jobs). Looping every job type uniformly
  // and letting the ?? 0 fallback handle the zero cases keeps this simple.
  function breakdownBy(column: 'waiting' | 'on_process' | 'closed') {
    return JOB_TYPE_ORDER
      .map(jt => ({ jobType: jt, ...JOB_TYPE_STYLE[jt], count: statusMatrix.find(r => r.job_type === jt)?.[column] ?? 0 }))
      .filter(row => row.count > 0);
  }

  // Open Job = Waiting + On Process of every job type (not just M/C Down) —
  // same job-type breakdown pattern as the other three cards.
  const openJobBreakdown = $derived.by(() =>
    JOB_TYPE_ORDER
      .map(jt => {
        const r = statusMatrix.find(row => row.job_type === jt);
        return { jobType: jt, ...JOB_TYPE_STYLE[jt], count: (r?.waiting ?? 0) + (r?.on_process ?? 0) };
      })
      .filter(row => row.count > 0)
  );
  const waitingBreakdown   = $derived(breakdownBy('waiting'));
  const onProcessBreakdown = $derived(breakdownBy('on_process'));
  const closedBreakdown    = $derived(breakdownBy('closed'));
  const openJobTotal       = $derived(fleetKpi.waiting_for_tech + fleetKpi.on_process);

  const availabilityPct = $derived.by(() => {
    const total = fleetKpi.key_machines;
    if (total === 0) return 0;
    return Math.round((1 - fleetKpi.mc_down / total) * 1000) / 10;
  });

  const maxTopHours = $derived(topMachines.length > 0 ? Math.max(...topMachines.map(m => m.down_hours)) : 1);
  const maxReasonHours = $derived(topReasons.length > 0 ? Math.max(...topReasons.map(r => r.hours)) : 1);
  const totalReasonHours = $derived(topReasons.reduce((s, r) => s + r.hours, 0) || 1);

  function fmtH(h: number): string {
    if (!h) return '0h';
    return h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`;
  }

  onMount(() => {
    loadData();
    const timer = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(timer);
  });
</script>

<svelte:head><title>Command Center — EMH Dashboard</title></svelte:head>

<PageHeader
  title="Engineering Command Center"
  subtitle="เครื่องไหนเสีย? ใครกำลังแก้? เพราะอะไร? — ตอบได้ในหน้าเดียว ก่อนต้องโทรถามใคร"
  badge="Live"
  refreshAt={lastUpdated || new Date().toISOString()}
/>

<!-- Process filter -->
<div class="area-filter">
  <span class="af-label">Process</span>
  <button class="chip" class:active={filterAreas.length === 0} onclick={() => { filterAreas = []; loadData(); }}>All</button>
  {#each ALL_AREAS as a (a)}
    <button class="chip" class:active={filterAreas.includes(a)} onclick={() => toggleArea(a)}>{a}</button>
  {/each}
</div>

{#if error}
  <div class="state-banner error">⚠ {error}</div>
{:else if loading && fleetKpi.key_machines === 0}
  <div class="state-banner loading">Loading…</div>
{/if}

<!-- ══════════════════ KPI ROW ══════════════════ -->
<div class="cc-kpi-grid">
  <KpiCard label="Availability" value="{availabilityPct}%" accent="var(--color-primary)" icon="🏭" href="{base}/utilization" />
  <KpiCard label="Breakdown Events (30d)" value={downtimeKpi.total_events} accent="var(--status-down)" icon="🔴" href="{base}/downtime" />
  <KpiCard label="Total Downtime" value={fmtH(downtimeKpi.total_hours)} accent="var(--status-waiting)" icon="⏱️" sub="30-day window" href="{base}/downtime" />
  <KpiCard label="MTTR" value="{Math.round(downtimeKpi.avg_repair_min)}m" accent="var(--status-setup)" icon="🔧" href="{base}/downtime" />
  <KpiCard label="MTBF" value={fmtH(mtbf.fleet_mtbf_hours)} accent="var(--color-accent-blue)" icon="🔁" sub="{mtbf.fleet_down_events} failures" href="{base}/downtime" />

  <div class="kpi-card pending">
    <span class="kpi-accent" style="background:var(--status-pm)"></span>
    <div class="kpi-body">
      <span class="kpi-icon" style="background:#7020761A">🗓️</span>
      <div class="kpi-text">
        <span class="kpi-value muted">—</span>
        <span class="kpi-sub">รอ DB schema</span>
      </div>
    </div>
    <div class="kpi-foot"><span class="kpi-label">PM Compliance</span></div>
  </div>

  <KpiCard label="Open Work Orders" value={fleetKpi.waiting_for_tech + fleetKpi.on_process} accent="var(--color-accent-orange)" icon="📋" href="{base}/" />
</div>

<!-- ══════════════════ LIVE MACHINE STATUS ══════════════════ -->
<section class="section">
  <div class="section-head">
    <div>
      <span class="eyebrow">ตอนนี้คอขวดอยู่ตรงไหน? — before Production calls you</span>
      <div class="section-title">Live Machine Status</div>
    </div>
  </div>

  <div class="status-strip">
    <div class="status-pill" style="border-color:var(--status-running)">
      <div class="status-top">
        <span class="status-dot" style="background:var(--status-running)"></span>
        <div><div class="status-num">{fleetKpi.running}</div><div class="status-lbl">Running</div></div>
      </div>
      <div class="status-empty">เครื่องที่ไม่มีงานเปิดอยู่</div>
    </div>

    <div class="status-pill" style="border-color:var(--status-down)">
      <div class="status-top">
        <span class="status-dot" style="background:var(--status-down)"></span>
        <div><div class="status-num">{openJobTotal}</div><div class="status-lbl">Open Job</div></div>
      </div>
      {#if openJobBreakdown.length > 0}
        <div class="status-breakdown">
          {#each openJobBreakdown as row (row.jobType)}
            <div class="brow">
              <span class="bdot" style="background:{row.color}"></span>
              <span class="bcount">{row.count}</span>
              <span class="bname">{row.label}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="status-pill" style="border-color:var(--status-waiting)">
      <div class="status-top">
        <span class="status-dot" style="background:var(--status-waiting)"></span>
        <div><div class="status-num">{fleetKpi.waiting_for_tech}</div><div class="status-lbl">Waiting For Tech</div></div>
      </div>
      {#if waitingBreakdown.length > 0}
        <div class="status-breakdown">
          {#each waitingBreakdown as row (row.jobType)}
            <div class="brow">
              <span class="bdot" style="background:{row.color}"></span>
              <span class="bcount">{row.count}</span>
              <span class="bname">{row.label}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="status-pill" style="border-color:var(--status-setup)">
      <div class="status-top">
        <span class="status-dot" style="background:var(--status-setup)"></span>
        <div><div class="status-num">{fleetKpi.on_process}</div><div class="status-lbl">On Process</div></div>
      </div>
      {#if onProcessBreakdown.length > 0}
        <div class="status-breakdown">
          {#each onProcessBreakdown as row (row.jobType)}
            <div class="brow">
              <span class="bdot" style="background:{row.color}"></span>
              <span class="bcount">{row.count}</span>
              <span class="bname">{row.label}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="status-pill" style="border-color:var(--status-running)">
      <div class="status-top">
        <span class="status-dot" style="background:var(--status-running)"></span>
        <div><div class="status-num">{fleetKpi.closed_this_shift}</div><div class="status-lbl">Completed Job</div></div>
      </div>
      {#if closedBreakdown.length > 0}
        <div class="status-breakdown">
          {#each closedBreakdown as row (row.jobType)}
            <div class="brow">
              <span class="bdot" style="background:{row.color}"></span>
              <span class="bcount">{row.count}</span>
              <span class="bname">{row.label}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <div class="process-grid">
    {#each ALL_AREAS as a (a)}
      {@const k = processKpi[a]}
      {@const total = k?.key_machines ?? 0}
      {@const isBottleneck = total > 0 && (k.mc_down + k.waiting_for_tech) / total > 0.15}
      <div class="proc-card" class:bottleneck={isBottleneck}>
        <div class="proc-name">{a}</div>
        <div class="proc-count">{total} machines</div>
        {#if total > 0}
          <div class="proc-bar">
            <span style="background:var(--status-running);flex:{Math.max(k.running,0.01)}"></span>
            {#if k.mc_down > 0}<span style="background:var(--status-down);flex:{k.mc_down}"></span>{/if}
            {#if k.waiting_for_tech > 0}<span style="background:var(--status-waiting);flex:{k.waiting_for_tech}"></span>{/if}
            {#if k.on_process > 0}<span style="background:var(--status-setup);flex:{k.on_process}"></span>{/if}
          </div>
          <div class="proc-legend">
            <span><b>{k.running}</b> run</span>
            {#if k.mc_down > 0}<span style="color:var(--status-down)"><b>{k.mc_down}</b> down</span>{/if}
            {#if k.waiting_for_tech > 0}<span style="color:var(--status-waiting)"><b>{k.waiting_for_tech}</b> wait</span>{/if}
            {#if k.on_process > 0}<span style="color:var(--status-setup)"><b>{k.on_process}</b> proc</span>{/if}
          </div>
        {:else}
          <div class="proc-legend"><span class="muted">no data</span></div>
        {/if}
      </div>
    {/each}
  </div>
</section>

<!-- ══════════════════ BREAKDOWN & DOWNTIME ══════════════════ -->
<section class="section">
  <div class="section-head">
    <div>
      <span class="eyebrow">ทำไมถึงเสีย? หนักสุดที่ไหน? — Pareto before opinion</span>
      <div class="section-title">Breakdown &amp; Downtime Analysis</div>
    </div>
  </div>

  <div class="two-col">
    <div class="chart-card">
      <div class="card-title">Downtime Top 10 · by Machine (hrs, 30d)</div>
      {#if topMachines.length === 0}
        <div class="empty-msg">No M/C Down events in this window</div>
      {:else}
        <div class="barlist">
          {#each topMachines as m (m.machine_id)}
            <div class="barlist-row">
              <span class="barlist-label">{m.machine_id}</span>
              <div class="barlist-track"><span class="barlist-fill" style="width:{(m.down_hours / maxTopHours) * 100}%"></span></div>
              <span class="barlist-val">{m.down_hours}h</span>
            </div>
          {/each}
        </div>

        {#if topMachines[0]}
          <div class="drilldown">
            <div class="dd-node"><b>{topMachines[0].machine_id}</b><span>Machine</span></div>
            <span class="dd-arrow">→</span>
            <div class="dd-node"><b>M/C DOWN ×{topMachines[0].event_count}</b><span>Breakdown</span></div>
            <span class="dd-arrow">→</span>
            <div class="dd-node"><b>Avg {topMachines[0].avg_mttr_min}m</b><span>Repair time</span></div>
            <span class="dd-arrow">→</span>
            <a class="dd-node" href="{base}/downtime">View full history →</a>
          </div>
        {/if}

        <div class="ai-preview">
          <div class="ai-preview-head">
            <span style="font-size:15px">🔮</span>
            <span class="ai-preview-title">Suggested Investigation — Claude AI</span>
            <span class="tag phase2">Phase 2 — not live</span>
          </div>
          <p class="ai-preview-note">
            เชื่อมโยง breakdown pattern, PM history และ work order อัตโนมัติ — ยังไม่ได้ implement ในเวอร์ชันนี้
          </p>
        </div>
      {/if}
    </div>

    <div class="chart-card">
      <div class="card-title">Top Breakdown Symptoms</div>
      {#if topReasons.length === 0}
        <div class="empty-msg">No data in this window</div>
      {:else}
        <div class="causelist">
          {#each topReasons as r, i (r.reason)}
            <div class="cause-row">
              <span class="cause-rank">{i + 1}</span>
              <div class="cause-main">
                <span class="cause-name">{r.reason}</span>
                <div class="cause-track"><span class="cause-fill" style="width:{(r.hours / maxReasonHours) * 100}%"></span></div>
              </div>
              <span class="cause-meta">{r.count} · {Math.round(r.hours / totalReasonHours * 100)}%</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</section>

<!-- ══════════════════ PM MONITORING (pending) ══════════════════ -->
<section class="section">
  <div class="section-head">
    <div>
      <span class="eyebrow">อะไรควรตรวจก่อนที่จะเสีย? — PM ตัวไหนกำลัง overdue</span>
      <div class="section-title">PM Monitoring</div>
    </div>
  </div>
  <div class="pending-card">
    <span class="pending-icon">🗓️</span>
    <div>
      <div class="pending-title">PM Compliance &amp; Schedule — pending</div>
      <div class="pending-desc">
        ยังไม่มี table เก็บ PM plan/due date ในระบบ MSSQL ที่ backend เชื่อมอยู่ — ต้องยืนยัน schema ก่อนจึงจะแสดงข้อมูลจริงได้
        (ตรวจสอบแล้วว่า <code>job_type='PM'</code> เป็นแค่ event type หนึ่งในตารางเดียวกับ M/C Down ไม่มีตาราง plan/due date แยก)
      </div>
    </div>
  </div>
</section>

<!-- ══════════════════ PHASE 2 ROADMAP ══════════════════ -->
<section class="section">
  <div class="section-head">
    <div>
      <span class="eyebrow">Deferred — revisit after MVP</span>
      <div class="section-title">Phase 2 Roadmap</div>
    </div>
  </div>
  <div class="phase2-grid">
    <div class="phase2-card">
      <span class="phase2-icon">🧰</span>
      <div>
        <div class="phase2-title">Spare Parts Usage</div>
        <div class="phase2-desc">อะไหล่ตัวไหนถูกใช้บ่อยผิดปกติ — ต้องหา table stock/usage ในระบบก่อน</div>
      </div>
    </div>
    <div class="phase2-card">
      <span class="phase2-icon">💬</span>
      <div>
        <div class="phase2-title">Ask Claude — Natural Language Query</div>
        <div class="phase2-desc">ถามได้ตรงๆ "เครื่องไหน downtime สูงสุดเดือนนี้" แล้ว Claude ประกอบคำตอบจากทุก endpoint</div>
      </div>
    </div>
  </div>
</section>

<style>
  .area-filter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm);
    padding: 10px 14px;
    margin-bottom: var(--gutter);
  }
  .af-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--color-text-muted);
    margin-right: 4px;
    white-space: nowrap;
  }

  .state-banner {
    padding: 10px 16px;
    border-radius: var(--r-sm);
    font-size: 13px;
    font-weight: 600;
    margin-bottom: var(--gutter);
  }
  .state-banner.error   { background: #FFF0F0; border: 1px solid var(--status-down); color: var(--status-down); }
  .state-banner.loading { background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted); }

  /* ── KPI row ── */
  .cc-kpi-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 12px;
    margin-bottom: var(--gutter);
  }
  @media (max-width: 1300px) { .cc-kpi-grid { grid-template-columns: repeat(4, 1fr); } }
  @media (max-width: 800px)  { .cc-kpi-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 560px)  { .cc-kpi-grid { grid-template-columns: 1fr; } }

  .kpi-card.pending {
    background: var(--color-surface);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--r-sm);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .kpi-card.pending .kpi-accent { display: block; height: 5px; width: 100%; opacity: 0.4; }
  .kpi-card.pending .kpi-body { display: flex; align-items: center; gap: 12px; padding: 12px 14px 6px; }
  .kpi-card.pending .kpi-icon { width: 38px; height: 38px; border-radius: var(--r-sm); display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
  .kpi-card.pending .kpi-text { display: flex; flex-direction: column; gap: 2px; }
  .kpi-card.pending .kpi-value.muted { font-size: 32px; font-weight: 700; line-height: 1; color: var(--color-text-disabled); }
  .kpi-card.pending .kpi-sub { font-size: 11px; color: var(--color-text-muted); }
  .kpi-card.pending .kpi-foot { padding: 6px 14px 12px; }
  .kpi-card.pending .kpi-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); }

  /* ── Sections ── */
  .section { margin-bottom: 28px; }
  .section-head { margin-bottom: 12px; }
  .eyebrow {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--color-accent-orange);
    letter-spacing: 0.02em;
    margin-bottom: 3px;
  }
  .section-title { font-size: 16px; font-weight: 800; color: var(--color-text-heading); }

  .card-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-dark);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding-bottom: 10px;
    border-bottom: 2px solid var(--color-border);
    margin-bottom: 12px;
  }

  .empty-msg { color: var(--color-text-muted); font-size: 13px; padding: 16px 0; text-align: center; }

  /* ── Live status ── */
  .status-strip { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 14px; }
  .status-pill {
    border-radius: var(--r-sm);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 9px;
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface);
  }
  .status-top { display: flex; align-items: center; gap: 10px; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .status-num { font-size: 21px; font-weight: 800; color: var(--color-text-heading); font-variant-numeric: tabular-nums; line-height: 1; }
  .status-lbl { font-size: 10px; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.03em; margin-top: 2px; }

  @media (max-width: 1100px) { .status-strip { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 720px)  { .status-strip { grid-template-columns: repeat(2, 1fr); } }

  .status-empty { font-size: 11px; color: var(--color-text-disabled); padding-top: 9px; border-top: 1px dashed var(--color-border); }

  .status-breakdown {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding-top: 9px;
    border-top: 1px dashed var(--color-border);
  }
  .brow { display: flex; align-items: center; gap: 7px; font-size: 11px; }
  .bdot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .bcount { font-weight: 800; color: var(--color-text-heading); font-variant-numeric: tabular-nums; min-width: 16px; }
  .bname { color: var(--color-text-muted); font-weight: 600; }

  .process-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
  @media (max-width: 1300px) { .process-grid { grid-template-columns: repeat(4, 1fr); } }
  @media (max-width: 800px)  { .process-grid { grid-template-columns: repeat(2, 1fr); } }

  .proc-card {
    border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm);
    padding: 10px 12px;
    background: var(--color-surface);
    position: relative;
  }
  .proc-card.bottleneck { border-color: var(--status-down); box-shadow: 0 0 0 1px var(--status-down) inset; }
  .proc-card.bottleneck::before {
    content: '⚠ FOCUS';
    position: absolute; top: -8px; right: 8px;
    background: var(--status-down); color: #fff;
    font-size: 8.5px; font-weight: 800; letter-spacing: 0.04em;
    padding: 2px 6px; border-radius: 3px;
  }
  .proc-name { font-size: 12.5px; font-weight: 800; color: var(--color-text-dark); }
  .proc-count { font-size: 10.5px; color: var(--color-text-muted); margin-bottom: 8px; }
  .proc-bar { display: flex; height: 7px; border-radius: 4px; overflow: hidden; background: var(--color-surface-gray); margin-bottom: 6px; }
  .proc-bar span { height: 100%; }
  .proc-legend { display: flex; gap: 8px; font-size: 9.5px; color: var(--color-text-muted); flex-wrap: wrap; font-variant-numeric: tabular-nums; }
  .proc-legend b { color: var(--color-text-dark); }
  .proc-legend .muted { color: var(--color-text-disabled); }

  /* ── Downtime analysis ── */
  .two-col { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; }
  @media (max-width: 1200px) { .two-col { grid-template-columns: 1fr; } }

  .barlist { display: flex; flex-direction: column; gap: 9px; }
  .barlist-row { display: grid; grid-template-columns: 90px 1fr 50px; align-items: center; gap: 8px; }
  .barlist-label { font-family: ui-monospace, 'SF Mono', Consolas, monospace; font-size: 11px; font-weight: 600; color: var(--color-text-dark); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .barlist-track { height: 16px; background: var(--color-surface-gray); border-radius: 3px; overflow: hidden; }
  .barlist-fill { display: block; height: 100%; border-radius: 3px 0 0 3px; background: var(--status-down); }
  .barlist-val { font-size: 11px; font-weight: 700; color: var(--color-text-dark); text-align: right; font-variant-numeric: tabular-nums; }

  .drilldown {
    margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--color-border);
    display: flex; align-items: center; flex-wrap: wrap;
  }
  .dd-node {
    background: var(--color-surface-alt); border: 1px solid var(--color-border-strong); border-radius: var(--r-sm);
    padding: 7px 12px; font-size: 11.5px; text-decoration: none; color: inherit;
  }
  .dd-node b { display: block; font-size: 12.5px; color: var(--color-text-heading); }
  .dd-node span { color: var(--color-text-muted); font-size: 10.5px; }
  .dd-arrow { color: var(--color-text-disabled); font-size: 14px; padding: 0 8px; }

  .ai-preview {
    margin-top: 14px; border: 1.5px dashed var(--color-accent-blue); border-radius: var(--r-sm);
    background: var(--color-surface-alt); padding: 14px 16px;
  }
  .ai-preview-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .ai-preview-title { font-size: 12px; font-weight: 800; color: var(--color-primary); }
  .ai-preview-note { margin: 0; font-size: 12px; color: var(--color-text-muted); }
  .tag { display: inline-flex; align-items: center; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; margin-left: auto; white-space: nowrap; }
  .tag.phase2 { background: var(--color-surface-gray); color: var(--color-text-muted); }

  .causelist { display: flex; flex-direction: column; gap: 10px; }
  .cause-row { display: flex; align-items: center; gap: 10px; }
  .cause-rank {
    width: 20px; height: 20px; border-radius: 50%; background: var(--color-surface-gray); color: var(--color-text-muted);
    font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .cause-main { flex: 1; min-width: 0; }
  .cause-name { font-size: 12px; font-weight: 700; color: var(--color-text-dark); }
  .cause-track { height: 6px; background: var(--color-surface-gray); border-radius: 3px; margin-top: 4px; overflow: hidden; }
  .cause-fill { display: block; height: 100%; background: var(--status-down); border-radius: 3px; }
  .cause-meta { font-size: 11px; color: var(--color-text-muted); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }

  /* ── PM pending (distinct amber tone — blocked on data, not deferred scope) ── */
  .pending-card {
    border: 1.5px dashed #E0A100;
    border-radius: var(--r-sm);
    background: #FFF8E8;
    padding: 16px 18px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }
  .pending-icon {
    width: 40px; height: 40px; border-radius: 8px; background: #FFF1CC; color: #B15A05;
    display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;
  }
  .pending-title { font-size: 13.5px; font-weight: 800; color: #8A6D00; }
  .pending-desc { font-size: 12px; color: #7A6432; margin-top: 4px; line-height: 1.6; }
  .pending-desc code { background: #FFEFC2; padding: 1px 5px; border-radius: 3px; font-size: 11.5px; }

  /* ── Phase 2 (deliberately deferred scope — neutral gray) ── */
  .phase2-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 900px) { .phase2-grid { grid-template-columns: 1fr; } }
  .phase2-card {
    border: 1.5px dashed var(--color-border-strong);
    border-radius: var(--r-sm);
    padding: 18px;
    background: repeating-linear-gradient(135deg, var(--color-surface) 0 12px, var(--color-surface-alt) 12px 24px);
    display: flex; align-items: center; gap: 14px;
  }
  .phase2-icon {
    width: 44px; height: 44px; border-radius: 8px; background: var(--color-surface-gray); color: var(--color-text-disabled);
    display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;
  }
  .phase2-title { font-size: 13.5px; font-weight: 800; color: var(--color-text-muted); }
  .phase2-desc { font-size: 11.5px; color: var(--color-text-disabled); margin-top: 2px; }
</style>
