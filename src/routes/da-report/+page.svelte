<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';

  // ── Types ─────────────────────────────────────────────────────────────────
  interface EventItem  { job_type:string; t_start:string; t_end:string; des_job:string; dur_min:number; tech:string; }
  interface MachineRow {
    machine_id:string; package:string;
    wait_down_min:number; down_min:number; wait_setup_min:number; setup_min:number;
    setup_conv_min:number; sbo_min:number; total_loss_min:number; util_pct:number;
    events:EventItem[];
  }
  interface DaKpi {
    total:number; n_down:number; n_setup:number; n_full:number; n_low:number;
    avg_util:number; down_pct:number; wait_pct:number; setup_conv_pct:number; sbo_pct:number; n_tech:number;
  }
  interface PackageOpt { value:string; label:string; }

  // ── Job type config ────────────────────────────────────────────────────────
  const JOB_ABBR: Record<string,string> = {
    'M/C DOWN':'DOWN','ENGINEERING DOWN':'ENG↓','FACILITY DOWN':'FAC↓',
    'PM':'PM','SETUP':'SETUP','SETUP BY OPERATOR':'SBO',
    'CONVERT':'CONV','CLEAN MOLD':'CLEAN','CHANGE CAP':'CHG CAP',
  };
  const JOB_COLOR: Record<string,{bg:string;tx:string}> = {
    'M/C DOWN':         {bg:'#CC0000',tx:'#fff'},
    'ENGINEERING DOWN': {bg:'#990000',tx:'#fff'},
    'FACILITY DOWN':    {bg:'#FD7F20',tx:'#fff'},
    'PM':               {bg:'#702076',tx:'#fff'},
    'SETUP':            {bg:'#1D9CE4',tx:'#fff'},
    'SETUP BY OPERATOR':{bg:'#17A2B8',tx:'#fff'},
    'CONVERT':          {bg:'#009688',tx:'#fff'},
    'CLEAN MOLD':       {bg:'#5EBF33',tx:'#fff'},
    'CHANGE CAP':       {bg:'#8A8A8A',tx:'#fff'},
  };

  // ── State ─────────────────────────────────────────────────────────────────
  let selDate      = $state(new Date().toISOString().slice(0,10));
  let selShift     = $state<'Day'|'Night'>('Night');
  let pkgOptions   = $state<PackageOpt[]>([]);
  let selPackages  = $state<string[]>([]);
  let pkgLoading   = $state(false);

  let machines     = $state<MachineRow[]>([]);
  let kpi          = $state<DaKpi|null>(null);
  let kpi7d        = $state<Partial<DaKpi> & { days: number; down_events?: number; setup_events?: number } | null>(null);
  let pkgLabel     = $state('');
  let timeRange    = $state('');
  let loading      = $state(false);
  let error        = $state<string|null>(null);
  let chip         = $state('ALL');
  let pkgSearch    = $state('');

  const filteredPkgOpts = $derived(
    pkgSearch.trim()
      ? pkgOptions.filter(o => o.label.toLowerCase().includes(pkgSearch.toLowerCase()))
      : pkgOptions
  );

  // ── Derived filtered rows ─────────────────────────────────────────────────
  const filtered = $derived.by(() => {
    if (chip === 'DOWN')  return machines.filter(r => r.down_min > 0);
    if (chip === 'SETUP') return machines.filter(r => r.down_min === 0 && r.setup_min + r.wait_setup_min > 0);
    if (chip === 'FULL')  return machines.filter(r => r.total_loss_min === 0);
    if (chip === '<80%')  return machines.filter(r => r.util_pct < 80);
    return machines;
  });

  const chipCounts = $derived({
    ALL:   machines.length,
    DOWN:  machines.filter(r => r.down_min > 0).length,
    SETUP: machines.filter(r => r.down_min === 0 && r.setup_min + r.wait_setup_min > 0).length,
    FULL:  machines.filter(r => r.total_loss_min === 0).length,
    '<80%': machines.filter(r => r.util_pct < 80).length,
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function utilColor(p:number) { return p >= 90 ? '#5EBF33' : p >= 85 ? '#FD7F20' : '#CC0000'; }
  function fmtMin(v:number) { return v ? String(v) : '—'; }
  function fmtDate(s:string) {
    try { return new Date(s).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
    catch { return s; }
  }

  // ── Load packages when date changes ───────────────────────────────────────
  async function loadPackages() {
    if (!selDate) return;
    pkgLoading = true;
    selPackages = [];
    pkgOptions = [];
    try {
      const res = await fetch(`${base}/api/da/packages?date=${selDate}`);
      const json = await res.json();
      pkgOptions = json.data?.options ?? [];
    } catch { pkgOptions = []; }
    pkgLoading = false;
  }

  // ── Load shift report + 7-day historical average ──────────────────────────
  async function loadReport() {
    if (!selDate || selPackages.length === 0) return;
    loading = true; error = null; kpi7d = null;
    try {
      const pkgsParam = selPackages.join(',');
      const pkgsEnc = encodeURIComponent(pkgsParam);

      // Fetch current + last 7 days in parallel
      const base7 = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(selDate);
        d.setDate(d.getDate() - (i + 1));
        return d.toISOString().slice(0, 10);
      });
      const [main, ...hist] = await Promise.all([
        fetch(`${base}/api/da/report?date=${selDate}&shift=${selShift}&packages=${pkgsEnc}`).then(r => r.json()),
        ...base7.map(d => fetch(`${base}/api/da/report?date=${d}&shift=${selShift}&packages=${pkgsEnc}`)
          .then(r => r.json()).catch(() => null)),
      ]);

      if (main.error) { error = main.error.message; loading = false; return; }
      const d = main.data;
      machines  = d.machines   ?? [];
      kpi       = d.kpi        ?? null;
      pkgLabel  = d.pkg_label  ?? '';
      timeRange = d.time_range ?? '';
      chip      = 'ALL';

      // Compute 7-day averages from historical data (kpi fields + event counts)
      const DOWN_T = new Set(['M/C DOWN','ENGINEERING DOWN','FACILITY DOWN']);
      const SETUP_T = new Set(['SETUP','CONVERT','CLEAN MOLD','CHANGE CAP']);
      const valid = hist.filter(h => h?.data?.kpi?.total > 0);
      if (valid.length > 0) {
        const kpis = valid.map(h => h.data.kpi as DaKpi);
        const avg = <T extends keyof DaKpi>(k: T) =>
          Math.round(kpis.reduce((s, v) => s + (v[k] as number), 0) / kpis.length * 10) / 10;
        // event counts per day from machines arrays
        const downEvts = valid.map(h =>
          (h.data.machines as MachineRow[]).reduce((s, m) =>
            s + m.events.filter(e => DOWN_T.has((e.job_type||'').toUpperCase())).length, 0));
        const setupEvts = valid.map(h =>
          (h.data.machines as MachineRow[]).reduce((s, m) =>
            s + m.events.filter(e => SETUP_T.has((e.job_type||'').toUpperCase())).length, 0));
        const avgArr = (arr: number[]) => Math.round(arr.reduce((s,v)=>s+v,0)/arr.length);
        kpi7d = {
          days: valid.length,
          avg_util: avg('avg_util'), down_pct: avg('down_pct'), wait_pct: avg('wait_pct'),
          setup_conv_pct: avg('setup_conv_pct'), sbo_pct: avg('sbo_pct'),
          n_down: avg('n_down'), n_tech: avg('n_tech'), n_low: avg('n_low'), n_full: avg('n_full'),
          down_events: avgArr(downEvts),
          setup_events: avgArr(setupEvts),
        };
      }
    } catch (e) { error = e instanceof Error ? e.message : 'Error'; }
    loading = false;
  }

  // ── Export HTML ───────────────────────────────────────────────────────────
  function exportHtml() {
    if (!machines.length) return;
    const rows = filtered;
    const d_fmt = fmtDate(selDate);
    const n = rows.length;
    const n_down  = rows.filter(r => r.down_min > 0).length;
    const avg_u   = n ? (rows.reduce((s,r) => s+r.util_pct, 0)/n).toFixed(1) : '0';
    const uc      = parseFloat(avg_u) >= 90 ? '#5EBF33' : parseFloat(avg_u) >= 85 ? '#FD7F20' : '#CC0000';
    const fm      = n * 720 || 1;
    const dpct    = (rows.reduce((s,r)=>s+r.down_min,0)/fm*100).toFixed(1);
    const wpct    = (rows.reduce((s,r)=>s+r.wait_down_min+r.wait_setup_min,0)/fm*100).toFixed(1);
    const spct    = (rows.reduce((s,r)=>s+r.setup_conv_min,0)/fm*100).toFixed(1);
    const sbopct  = (rows.reduce((s,r)=>s+r.sbo_min,0)/fm*100).toFixed(1);

    const kpiHtml = [
      kc(String(n), 'TOTAL MACHINES', '#0E3689'),
      kc(String(n_down), 'M/C DOWN', '#CC0000'),
      kc(avg_u+'%', 'AVG UTILIZATION', uc),
      `<div style="align-self:center;font-size:10px;font-weight:700;color:#aaa;border-left:2px solid #e0e0e0;padding-left:10px;margin-left:4px;white-space:nowrap">SHIFT LOSS %</div>`,
      kc(dpct+'%', '% DOWN TIME', '#CC0000', 'M/C DOWN repair'),
      kc(wpct+'%', '% WAIT', '#FD7F20', 'All waiting for tech'),
      kc(spct+'%', '% SETUP+CONV', '#1D9CE4', 'Setup / Convert'),
      kc(sbopct+'%', '% SBO', '#00897B', 'Setup by Operator'),
      `<div style="align-self:center;font-size:10px;font-weight:700;color:#aaa;border-left:2px solid #e0e0e0;padding-left:10px;margin-left:4px;white-space:nowrap">TECHS</div>`,
      kc(String(kpi?.n_tech ?? 0), 'TECH ON SHIFT', '#702076', 'on this package'),
    ].join('');

    function kc(val:string, lbl:string, col:string, sub='') {
      return `<div style="background:#fff;border-radius:8px;padding:12px 16px;border-top:4px solid ${col};box-shadow:0 2px 6px rgba(0,0,0,.08);flex:1;min-width:110px">
        <div style="font-size:28px;font-weight:800;color:${col};line-height:1.1">${val}</div>
        <div style="font-size:11px;font-weight:700;color:#555;margin-top:3px;letter-spacing:.5px">${lbl}</div>
        ${sub ? `<div style="font-size:10px;color:#999;margin-top:2px">${sub}</div>` : ''}
      </div>`;
    }

    const trs = rows.map((r,i) => {
      const bg = r.util_pct < 85 ? '#fff0f0' : r.util_pct < 90 ? '#fff8ee' : i%2===0 ? '#fff' : '#f7f7f7';
      const uc2 = utilColor(r.util_pct);
      const bar = `<div style="width:100%;height:8px;background:#e0e0e0;border-radius:3px;margin-bottom:3px"><div style="width:${Math.min(r.util_pct,100).toFixed(1)}%;height:8px;background:${uc2};border-radius:3px"></div></div><span style="font-weight:700;color:${uc2}">${r.util_pct.toFixed(1)}%</span>`;
      const badge = r.util_pct < 85 ? ` <span style="background:#ffebeb;color:#CC0000;border:1px solid #CC0000;border-radius:4px;font-size:10px;font-weight:700;padding:1px 5px">⚠ Insight</span>` : '';
      const pills = r.events.map(e => {
        const jt = (e.job_type||'').toUpperCase();
        const c = JOB_COLOR[jt] ?? {bg:'#8A8A8A',tx:'#fff'};
        const abbr = JOB_ABBR[jt] ?? jt.slice(0,6);
        const desc = (e.des_job||'').slice(0,25);
        const body = desc ? `${abbr} ${e.t_start}–${e.t_end} ${desc} (${e.dur_min}m)` : `${abbr} ${e.t_start}–${e.t_end} (${e.dur_min}m)`;
        return `<span style="background:${c.bg};color:${c.tx};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin:2px;display:inline-block;white-space:nowrap">${body}</span>`;
      }).join('') || '<span style="color:#aaa">—</span>';
      const fv = (v:number, col:string) => v ? `<span style="color:${col};font-weight:700">${v}</span>` : '<span style="color:#aaa">—</span>';
      const lc = r.util_pct < 85 ? '#CC0000' : r.total_loss_min > 0 ? '#FD7F20' : '#aaa';
      return `<tr style="background:${bg}">
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e0e0e0;color:#aaa;font-weight:600">${i+1}</td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e0e0e0"><strong style="color:#0E3689">${r.machine_id}</strong>${badge}</td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e0e0e0;text-align:right">${fv(r.wait_down_min,'#CC0000')}</td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e0e0e0;text-align:right">${fv(r.down_min,'#CC0000')}</td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e0e0e0;text-align:right">${fv(r.wait_setup_min,'#FD7F20')}</td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e0e0e0;text-align:right">${fv(r.setup_min,'#FD7F20')}</td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e0e0e0;text-align:right"><span style="color:${lc};font-weight:${r.total_loss_min?'700':'400'}">${r.total_loss_min||'—'}</span></td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e0e0e0;min-width:150px">${bar}</td>
        <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e0e0e0;max-width:500px">${pills}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>DA Report — ${d_fmt} ${selShift}</title>
    <style>body{font-family:'Segoe UI',Calibri,Arial,sans-serif;margin:0;background:#f7f7f7}@media print{body{background:#fff}}</style></head>
    <body>
    <div style="background:linear-gradient(135deg,#0E3689 0%,#1a4a9e 100%);padding:16px 28px;color:#fff">
      <div style="font-size:20px;font-weight:700;margin-bottom:4px">Die Attach — Utilization &amp; Downtime Report</div>
      <div style="font-size:13px;opacity:.85">${selShift} Shift &nbsp;·&nbsp; ${d_fmt} &nbsp;·&nbsp; ${timeRange} &nbsp;·&nbsp; ${pkgLabel} &nbsp;·&nbsp; ${n} machines</div>
    </div>
    <div style="padding:16px 24px 8px;display:flex;gap:12px;flex-wrap:wrap">${kpiHtml}</div>
    <div style="padding:0 24px 28px;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:#0E3689">
      <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:700;color:#fff;width:36px">#</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:700;color:#fff">MACHINE</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;color:#ffb3b3">WAIT DOWN</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;color:#ff8080">M/C DOWN</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;color:#ffd599">WAIT SETUP</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;color:#ffbe6f">SETUP</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:700;color:#fff">TOTAL LOSS</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:700;color:#fff">UTILIZATION</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:700;color:#fff">EVENTS IN SHIFT</th>
    </tr></thead><tbody>${trs}</tbody></table></div>
    </body></html>`;

    const blob = new Blob([html], {type:'text/html;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `da_report_${selDate}_${selShift}.html`; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Top 3 helpers ─────────────────────────────────────────────────────────
  // Top 3 machines + main criteria (dominant des_job by dur_min for matching events)
  function top3Machines(valFn: (r: MachineRow)=>number, evtTypes: string[]) {
    const types = new Set(evtTypes.map(t => t.toUpperCase()));
    return [...machines]
      .map(r => {
        const val = valFn(r);
        // Find dominant criteria from matching events
        const cmap = new Map<string,number>();
        for (const e of r.events) {
          if (!types.has((e.job_type||'').toUpperCase())) continue;
          const k = e.des_job?.trim() || e.job_type;
          if (k) cmap.set(k, (cmap.get(k) ?? 0) + e.dur_min);
        }
        const criteria = [...cmap.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] ?? '';
        return { id: r.machine_id, val, criteria };
      })
      .filter(x => x.val > 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, 3);
  }

  // Top 3 CRITERIA across all machines (for SBO) — returns hours + event count
  function top3Criteria(evtTypes: string[]) {
    const types = new Set(evtTypes.map(t => t.toUpperCase()));
    const cmap  = new Map<string, { min: number; count: number }>();
    for (const r of machines) {
      for (const e of r.events) {
        if (!types.has((e.job_type||'').toUpperCase())) continue;
        const k = e.des_job?.trim() || e.job_type;
        if (!k) continue;
        const prev = cmap.get(k) ?? { min: 0, count: 0 };
        cmap.set(k, { min: prev.min + e.dur_min, count: prev.count + 1 });
      }
    }
    return [...cmap.entries()]
      .sort((a, b) => b[1].min - a[1].min)
      .slice(0, 3)
      .map(([criteria, { min, count }]) => ({
        criteria,
        hours: (min / 60).toFixed(1),
        count,
      }));
  }

  const top3Down  = $derived(top3Machines(r => r.down_min,                        ['M/C DOWN']));
  const top3Wait  = $derived(top3Machines(r => r.wait_down_min+r.wait_setup_min,  ['M/C DOWN']));
  const top3Setup = $derived(top3Machines(r => r.setup_conv_min,                  ['SETUP','CONVERT','CLEAN MOLD','CHANGE CAP']));
  const top3Sbo   = $derived(top3Criteria(['SETUP BY OPERATOR']));

  // ── MTTR / MTTW + event counts per loss category ─────────────────────────
  const DOWN_TYPES  = new Set(['M/C DOWN','ENGINEERING DOWN','FACILITY DOWN']);
  const SETUP_TYPES = new Set(['SETUP','CONVERT','CLEAN MOLD','CHANGE CAP']);
  const SBO_TYPES   = new Set(['SETUP BY OPERATOR']);

  // DA IDLE: only "Idle*" events (e.g. "Idle Epoxy") — no Wait Plasma/Cratering for DA
  function isIdleEvent(desJob: string): boolean {
    return (desJob || '').trim().toLowerCase().startsWith('idle');
  }

  const lossStats = $derived.by(() => {
    let downEv=0, downMin=0;
    let waitDownMin=0, waitSetupMin=0;
    let setupEv=0, setupMin=0;
    let sboEv=0, sboMin=0;
    let idleEv=0, idleDurMin=0;  // IDLE: SBO events with idle/wait criteria
    let sboOnlyEv=0, sboOnlyDurMin=0;  // SBO: non-idle SBO events

    for (const m of machines) {
      downMin      += m.down_min;
      waitDownMin  += m.wait_down_min;
      waitSetupMin += m.wait_setup_min;
      setupMin     += m.setup_conv_min;
      sboMin       += m.sbo_min;
      for (const ev of m.events) {
        const jt = (ev.job_type || '').toUpperCase();
        if (DOWN_TYPES.has(jt))  downEv++;
        if (SETUP_TYPES.has(jt)) setupEv++;
        if (SBO_TYPES.has(jt)) {
          sboEv++;
          if (isIdleEvent(ev.des_job)) {
            idleEv++;
            idleDurMin += ev.dur_min;
          } else {
            sboOnlyEv++;
            sboOnlyDurMin += ev.dur_min;
          }
        }
      }
    }
    // Accumulate total repair minutes for total-time display
    let totalDownRepair = 0, totalWait = 0, totalSetupRepair = 0;
    for (const m of machines) {
      totalDownRepair  += m.down_min;
      totalWait        += m.wait_down_min + m.wait_setup_min;
      totalSetupRepair += m.setup_conv_min;
    }

    const r = (min: number, ev: number) => ev > 0 ? Math.round(min / ev) : 0;
    const fleetMin = machines.length * 720 || 1;

    // IDLE top 3 criteria by total duration
    const idleCriteriaMap = new Map<string, { min: number; count: number }>();
    for (const m of machines) {
      for (const ev of m.events) {
        if ((ev.job_type||'').toUpperCase() !== 'SETUP BY OPERATOR') continue;
        if (!isIdleEvent(ev.des_job)) continue;
        // Normalise: truncate long criteria at first comma
        const key = (ev.des_job||'').split(',')[0].trim() || 'Idle';
        const prev = idleCriteriaMap.get(key) ?? { min: 0, count: 0 };
        idleCriteriaMap.set(key, { min: prev.min + ev.dur_min, count: prev.count + 1 });
      }
    }
    const idleTop3 = [...idleCriteriaMap.entries()]
      .sort((a, b) => b[1].min - a[1].min)
      .slice(0, 3)
      .map(([criteria, { min, count }]) => ({ criteria, min, count }));

    // SBO-only % = sbo_pct minus idle fraction
    const idlePct = Math.round(idleDurMin / fleetMin * 100 * 10) / 10;

    return {
      down:  { events: downEv,  mttr: r(downMin, downEv),  totalMin: totalDownRepair },
      wait:  {
        evDown: downEv, evSetup: setupEv,
        mttwDown:  r(waitDownMin,  downEv),
        mttwSetup: r(waitSetupMin, setupEv),
        totalMin: totalWait,
      },
      setup: { events: setupEv, mttr: r(setupMin, setupEv), totalMin: totalSetupRepair },
      sbo:   { events: sboOnlyEv, mttr: r(sboOnlyDurMin, sboOnlyEv), totalMin: sboOnlyDurMin },
      idle:  { events: idleEv, totalMin: idleDurMin, pct: idlePct, avg: r(idleDurMin, idleEv), top3: idleTop3 },
    };
  });

  // ── 7d delta helpers ──────────────────────────────────────────────────────
  function delta(cur: number, avg: number | undefined, higherIsBetter = true): { txt: string; good: boolean } | null {
    if (avg == null) return null;
    const d = Math.round((cur - avg) * 10) / 10;
    if (d === 0) return { txt: '→ same', good: true };
    const sign = d > 0 ? '+' : '';
    const good = higherIsBetter ? d > 0 : d < 0;
    return { txt: `${sign}${d}`, good };
  }
  function deltaN(cur: number, avg: number | undefined, higherIsBetter = false) {
    return delta(cur, avg, higherIsBetter);
  }

  // ── Narrative Insight ─────────────────────────────────────────────────────
  const narrative = $derived.by(() => {
    if (!kpi || machines.length === 0) return null;

    const shiftMin = machines.length * 720;
    const totalLoss = machines.reduce((s, m) => s + m.total_loss_min, 0);
    const runMin = shiftMin - totalLoss;
    const topFailures = (() => {
      const map = new Map<string, number>();
      for (const m of machines)
        for (const e of m.events)
          if (['M/C DOWN','ENGINEERING DOWN','FACILITY DOWN'].includes((e.job_type||'').toUpperCase())) {
            const k = (e.des_job||'').split(',')[0].trim() || e.job_type;
            map.set(k, (map.get(k) ?? 0) + 1);
          }
      return [...map.entries()].sort((a,b) => b[1]-a[1]).slice(0,3);
    })();
    const worstMachine = [...machines].sort((a,b) => a.util_pct - b.util_pct)[0];
    const nBelow85 = machines.filter(m => m.util_pct < 85).length;
    const nFull = machines.filter(m => m.total_loss_min === 0).length;
    const avgVs7d = kpi7d ? (kpi.avg_util - (kpi7d.avg_util ?? kpi.avg_util)) : null;
    const trendTxt = avgVs7d == null ? '' :
      avgVs7d > 1 ? ` สูงกว่าค่าเฉลี่ย ${kpi7d!.days} วันที่ผ่านมา (${kpi7d!.avg_util}%)` :
      avgVs7d < -1 ? ` ต่ำกว่าค่าเฉลี่ย ${kpi7d!.days} วันที่ผ่านมา (${kpi7d!.avg_util}%)` :
      ` ใกล้เคียงค่าเฉลี่ย ${kpi7d!.days} วัน (${kpi7d!.avg_util}%)`;

    const failureSummary = topFailures.length
      ? `สาเหตุ down ที่พบบ่อยที่สุดคือ "${topFailures[0][0]}" (${topFailures[0][1]} ครั้ง)` +
        (topFailures[1] ? ` รองลงมาคือ "${topFailures[1][0]}" (${topFailures[1][1]} ครั้ง)` : '') + ' '
      : '';

    const waitNote = kpi.wait_pct >= 7
      ? `เวลารอช่าง ${kpi.wait_pct}% คิดเป็นกว่า 2 เท่าของเวลา down จริง — ควรพิจารณาเพิ่ม coverage ช่างในช่วง peak load `
      : '';

    const setupNote = kpi.setup_conv_pct >= 6
      ? `Setup+Convert สูงถึง ${kpi.setup_conv_pct}%${kd?.setup ? (kd.setup.good ? ' (ลดลงจาก avg)' : ' (เพิ่มขึ้นจาก avg — อาจมี package ที่ changeover ซับซ้อน)') : ''} `
      : '';

    const colletNote = topFailures[0]?.[0]?.toUpperCase().includes('COLLET')
      ? `พบ MAX COLLET COUNT ถึง ${topFailures[0][1]} ครั้ง — เป็นสัญญาณ consumable wear ควรวางแผน batch replacement ก่อน shift ถัดไป `
      : '';

    const belowNote = `เครื่องที่ util ต่ำกว่า 80% มีถึง ${machines.filter(m=>m.util_pct<80).length} เครื่อง คิดเป็นสูญเสียกำลังการผลิตสุทธิ ${Math.round(totalLoss/shiftMin*100)}% ของ machine-hour ทั้งหมด`;

    return `Fleet DA กะนี้มี utilization เฉลี่ย ${kpi.avg_util}%${trendTxt}. ${belowNote}. ${failureSummary}${colletNote}${waitNote}${setupNote}`.trim();
  });

  // Pre-computed deltas (avoids {@const} placement restrictions in template)
  const kd = $derived.by(() => {
    if (!kpi || !kpi7d) return null;
    return {
      n_down:   delta(kpi.n_down,        kpi7d.n_down,        false),
      avg_util: delta(kpi.avg_util,      kpi7d.avg_util,      true),
      n_tech:   delta(kpi.n_tech,        kpi7d.n_tech,        false),
      n_full:   delta(kpi.n_full,        kpi7d.n_full,        true),
      n_low:    delta(kpi.n_low,         kpi7d.n_low,         false),
      down_pct:    delta(kpi.down_pct,      kpi7d.down_pct,      false),
      wait_pct:    delta(kpi.wait_pct,      kpi7d.wait_pct,      false),
      setup:       delta(kpi.setup_conv_pct,kpi7d.setup_conv_pct,false),
      down_events: deltaN(lossStats.down.events,  kpi7d.down_events,  false),
      setup_events:deltaN(lossStats.setup.events, kpi7d.setup_events, false),
    };
  });

  function fmtMtx(min: number): string {
    if (!min) return '—';
    if (min < 60) return `${min}m`;
    return `${Math.floor(min/60)}h ${min%60}m`;
  }

  onMount(() => { loadPackages(); });
</script>

<svelte:head><title>DA Report — EMH Dashboard</title></svelte:head>

<!-- ── Header ────────────────────────────────────────────────────────────── -->
<div class="wb-header">
  <div>
    <h2>Die Attach — Utilization &amp; Downtime Report</h2>
    <p>{selShift} Shift &nbsp;·&nbsp; {selDate ? fmtDate(selDate) : '—'} &nbsp;·&nbsp; {timeRange || '—'} &nbsp;·&nbsp; {pkgLabel || 'No package selected'} &nbsp;·&nbsp; {kpi?.total ?? 0} machines</p>
  </div>
  <div class="hdr-actions">
    <button class="btn-export" onclick={exportHtml} disabled={machines.length===0}>↓ HTML Report</button>
  </div>
</div>

<!-- ── Filter bar ─────────────────────────────────────────────────────────── -->
<div class="filter-bar">
  <!-- Date -->
  <div class="fb-group">
    <label class="flbl" for="da-date">DATE</label>
    <input id="da-date" type="date" class="input" style="width:150px" bind:value={selDate}
      onchange={() => { loadPackages(); machines=[]; kpi=null; }} />
  </div>

  <!-- Shift -->
  <div class="fb-group">
    <span class="flbl">SHIFT</span>
    <div class="shift-btns">
      <button class="shift-btn" class:active={selShift==='Day'}   onclick={()=>{selShift='Day';   machines=[]; kpi=null;}}>☀ Day</button>
      <button class="shift-btn" class:active={selShift==='Night'} onclick={()=>{selShift='Night'; machines=[]; kpi=null;}}>🌙 Night</button>
    </div>
  </div>

  <!-- Package -->
  <div class="fb-group" style="flex:1;min-width:240px">
    <span class="flbl">
      PACKAGE
      {#if selPackages.length > 0}
        <span class="pkg-badge">{selPackages.length} selected</span>
      {/if}
    </span>
    {#if pkgLoading}
      <div class="pkg-placeholder">Loading…</div>
    {:else if pkgOptions.length === 0}
      <div class="pkg-placeholder">Select a date first</div>
    {:else}
      <div class="pkg-panel">
        <input class="input pkg-search" type="search" placeholder="Search package…" bind:value={pkgSearch} />
        <div class="pkg-list">
          {#each filteredPkgOpts as opt (opt.value)}
            <button
              class="pkg-item"
              class:active={selPackages.includes(opt.value)}
              onclick={() => {
                if (selPackages.includes(opt.value)) selPackages = selPackages.filter(x=>x!==opt.value);
                else selPackages = [...selPackages, opt.value];
              }}
            >
              <span class="pkg-check">{selPackages.includes(opt.value) ? '✓' : ''}</span>
              {opt.label}
            </button>
          {/each}
          {#if filteredPkgOpts.length === 0}
            <div class="pkg-placeholder" style="padding:8px 10px">No match</div>
          {/if}
        </div>
        <div class="pkg-footer">
          <button class="pkg-quick" onclick={() => selPackages=['__ALL__']}>All</button>
          {#if pkgOptions.some(o => o.value === '__QFN__')}
            <button class="pkg-quick" onclick={() => selPackages=['__QFN__']}>QFN only</button>
          {/if}
          <button class="pkg-quick" onclick={() => selPackages=[]}>Clear</button>
          <span class="pkg-count">{pkgOptions.filter(o=>!o.value.startsWith('__')).length} packages</span>
        </div>
      </div>
    {/if}
  </div>

  <div class="fb-group" style="justify-content:flex-end">
    <span class="flbl">&nbsp;</span>
    <button class="btn-load" onclick={loadReport} disabled={loading || selPackages.length===0}>
      {loading ? 'Loading…' : 'Load Report'}
    </button>
  </div>
</div>

{#if error}
  <div class="err-banner">⚠ {error}</div>
{/if}

{#if kpi}
  <!-- ── KPI section ──────────────────────────────────────────────────────── -->
  <div class="kpi-section">

    <!-- Row 1: Fleet — compact stat strip -->
    <div class="fleet-row">
      <span class="kpi-block-label">FLEET</span>
      <div class="fleet-stat" style="--c:var(--color-primary)">
        <span class="fs-val">{kpi.total}</span>
        <span class="fs-lbl">Machines</span>
      </div>
      <div class="fleet-stat" style="--c:#CC0000">
        <span class="fs-val">{kpi.n_down}</span>
        <span class="fs-lbl">M/C Down</span>
        {#if kd?.n_down}<span class="fs-delta" class:up={kd.n_down.good} class:dn={!kd.n_down.good}>{kd.n_down.txt}</span>{/if}
      </div>
      <div class="fleet-stat" style="--c:{utilColor(kpi.avg_util)}">
        <span class="fs-val">{kpi.avg_util}%</span>
        <span class="fs-lbl">Avg Util</span>
        {#if kd?.avg_util}<span class="fs-delta" class:up={kd.avg_util.good} class:dn={!kd.avg_util.good}>{kd.avg_util.txt}%</span>{/if}
      </div>
      <div class="fleet-stat" style="--c:#702076">
        <span class="fs-val">{kpi.n_tech}</span>
        <span class="fs-lbl">Techs on Shift</span>
      </div>
      <div class="fleet-stat" style="--c:#CC0000">
        <span class="fs-val">{machines.filter(r=>r.util_pct<80).length}</span>
        <span class="fs-lbl">Util &lt;80%</span>
        {#if kd?.n_low}<span class="fs-delta" class:up={kd.n_low.good} class:dn={!kd.n_low.good}>{kd.n_low.txt}</span>{/if}
      </div>
      {#if kpi7d}<span class="kpi7d-note">vs {kpi7d.days}d avg</span>{/if}
    </div>

    <!-- Row 2: Shift Loss % — full width -->
    <div class="loss-row">
      <span class="kpi-block-label" style="white-space:nowrap">SHIFT LOSS %</span>
      <div class="kpi-row-cards">

        <!-- DOWN TIME -->
        <div class="kc kc-hoverable" style="--c:#CC0000">
          <span class="kc-pct">{kpi.down_pct}%</span>
          {#if kd?.down_pct}<span class="kc-vs" class:vs-good={kd.down_pct.good} class:vs-bad={!kd.down_pct.good}>{kd.down_pct.txt}% vs avg</span>{/if}
          <span class="kc-lbl">Down Time</span>
          <div class="kc-meta">
            <span class="kc-ev">{lossStats.down.events} ev</span>
            {#if kd?.down_events}<span class="kc-ev-delta" class:ev-good={kd.down_events.good} class:ev-bad={!kd.down_events.good}>({kd.down_events.txt} ev)</span>{/if}
            <span class="kc-dot">·</span>
            <span class="kc-rate">MTTR <b>{fmtMtx(lossStats.down.mttr)}</b></span>
          </div>
          <div class="kc-total" style="color:#CC0000">Total <b>{fmtMtx(lossStats.down.totalMin)}</b></div>
        {#if top3Down.length}
          <div class="loss-tooltip">
            <div class="tt-title" style="color:#CC0000">Top · M/C DOWN</div>
            {#each top3Down as r, i}
              <div class="tt-row">
                <span class="tt-rank">#{i+1}</span>
                <span class="tt-mc">{r.id}</span>
                <span class="tt-val" style="color:#CC0000">{r.val}m</span>
              </div>
              {#if r.criteria}<div class="tt-criteria">{r.criteria}</div>{/if}
            {/each}
          </div>
        {/if}
        </div><!-- /DOWN TIME kc -->

        <!-- WAIT -->
        <div class="kc kc-hoverable" style="--c:#FD7F20">
          <span class="kc-pct">{kpi.wait_pct}%</span>
          {#if kd?.wait_pct}<span class="kc-vs" class:vs-good={kd.wait_pct.good} class:vs-bad={!kd.wait_pct.good}>{kd.wait_pct.txt}% vs avg</span>{/if}
          <span class="kc-lbl">Wait</span>
          <div class="kc-meta kc-meta-col">
            <div class="wait-row">
              <span class="wait-tag">Down</span>
              <span class="kc-rate">MTTW <b style="color:#CC0000">{fmtMtx(lossStats.wait.mttwDown)}</b></span>
            </div>
            <div class="wait-row">
              <span class="wait-tag">Setup</span>
              <span class="kc-rate">MTTW <b style="color:#FD7F20">{fmtMtx(lossStats.wait.mttwSetup)}</b></span>
            </div>
          </div>
          <div class="kc-total" style="color:#FD7F20">Total <b>{fmtMtx(lossStats.wait.totalMin)}</b></div>
          {#if top3Wait.length}
            <div class="loss-tooltip">
              <div class="tt-title" style="color:#FD7F20">Top · Wait time</div>
              {#each top3Wait as r, i}
                <div class="tt-row">
                  <span class="tt-rank">#{i+1}</span>
                  <span class="tt-mc">{r.id}</span>
                  <span class="tt-val" style="color:#FD7F20">{r.val}m</span>
                </div>
                {#if r.criteria}<div class="tt-criteria">{r.criteria}</div>{/if}
              {/each}
            </div>
          {/if}
        </div>

        <!-- SETUP+CONV -->
        <div class="kc kc-hoverable" style="--c:#1D9CE4">
          <span class="kc-pct">{kpi.setup_conv_pct}%</span>
          {#if kd?.setup}<span class="kc-vs" class:vs-good={kd.setup.good} class:vs-bad={!kd.setup.good}>{kd.setup.txt}% vs avg</span>{/if}
          <span class="kc-lbl">Setup+Conv</span>
          <div class="kc-meta">
            <span class="kc-ev">{lossStats.setup.events} ev</span>
            {#if kd?.setup_events}<span class="kc-ev-delta" class:ev-good={kd.setup_events.good} class:ev-bad={!kd.setup_events.good}>({kd.setup_events.txt} ev)</span>{/if}
            <span class="kc-dot">·</span>
            <span class="kc-rate">MTTR <b>{fmtMtx(lossStats.setup.mttr)}</b></span>
          </div>
          <div class="kc-total" style="color:#1D9CE4">Total <b>{fmtMtx(lossStats.setup.totalMin)}</b></div>
          {#if top3Setup.length}
            <div class="loss-tooltip">
              <div class="tt-title" style="color:#1D9CE4">Top · Setup+Convert</div>
              {#each top3Setup as r, i}
                <div class="tt-row">
                  <span class="tt-rank">#{i+1}</span>
                  <span class="tt-mc">{r.id}</span>
                  <span class="tt-val" style="color:#1D9CE4">{r.val}m</span>
                </div>
                {#if r.criteria}<div class="tt-criteria">{r.criteria}</div>{/if}
              {/each}
            </div>
          {/if}
        </div>

        <!-- SBO (excludes idle/wait) -->
        <div class="kc kc-hoverable" style="--c:#009688">
          <span class="kc-pct">{Math.max(0, Math.round((kpi.sbo_pct - lossStats.idle.pct) * 10) / 10)}%</span>
          <span class="kc-lbl">SBO</span>
          <div class="kc-meta">
            <span class="kc-ev">{lossStats.sbo.events} ev</span>
            <span class="kc-dot">·</span>
            <span class="kc-rate">MTTR <b>{fmtMtx(lossStats.sbo.mttr)}</b></span>
          </div>
          <div class="kc-total" style="color:#009688">Total <b>{fmtMtx(lossStats.sbo.totalMin)}</b></div>
          {#if top3Sbo.length}
            <div class="loss-tooltip">
              <div class="tt-title" style="color:#009688">Top criteria · SBO</div>
              {#each top3Sbo as r, i}
                <div class="tt-row tt-row-criteria">
                  <span class="tt-rank">#{i+1}</span>
                  <span class="tt-crit">{r.criteria}</span>
                  <span class="tt-val" style="color:#009688">{r.hours}h</span>
                </div>
                <div class="tt-criteria">{r.count} event{r.count !== 1 ? 's' : ''}</div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- IDLE (Idle + Wait Plasma/Cratering etc.) -->
        {#if lossStats.idle.events > 0}
          <div class="kc" style="--c:#8B5CF6">
            <span class="kc-pct">{lossStats.idle.pct}%</span>
            <span class="kc-lbl">Idle</span>
            <div class="kc-meta kc-meta-col" style="gap:3px">
              {#each lossStats.idle.top3 as t}
                <div class="idle-row">
                  <span class="idle-crit">{t.criteria.length > 14 ? t.criteria.slice(0,14)+'…' : t.criteria}</span>
                  <span class="idle-stats">
                    <span class="idle-ev">{t.count}ev</span>
                    <b style="color:#8B5CF6;font-size:10px">{fmtMtx(Math.round(t.min / t.count))}</b>
                  </span>
                </div>
              {/each}
            </div>
            <div class="kc-total" style="color:#8B5CF6">Total <b>{fmtMtx(lossStats.idle.totalMin)}</b></div>
          </div>
        {/if}

      </div><!-- /kpi-row-cards -->
    </div><!-- /loss-row -->
  </div><!-- /kpi-section -->

  <!-- ── Narrative Insight ────────────────────────────────────────────────── -->
  {#if narrative}
  <div class="narrative-card">
    <div class="narrative-hdr">
      <span class="narrative-icon">📋</span>
      <span>Narrative Insight</span>
      {#if kpi7d}<span class="narrative-badge">vs {kpi7d.days}-day avg</span>{/if}
    </div>
    <p class="narrative-body">{narrative}</p>
  </div>
  {/if}

  <!-- ── Chip filter ────────────────────────────────────────────────────── -->
  <div class="chip-bar">
    <div class="chip-left">
      <span class="show-lbl">SHOW</span>
      {#each [
        {id:'ALL',  label:'All',         count:chipCounts.ALL,         alert:false},
        {id:'DOWN', label:'M/C Down',    count:chipCounts.DOWN,        alert:false},
        {id:'SETUP',label:'Setup Loss',  count:chipCounts.SETUP,       alert:false},
        {id:'FULL', label:'100% Util',   count:chipCounts.FULL,        alert:false},
        {id:'<80%', label:'Util < 80%',  count:chipCounts['<80%'],     alert:true},
      ] as c (c.id)}
        <button class="chip-btn" class:active={chip===c.id} class:alert-chip={c.alert}
          onclick={()=>chip=c.id}>
          {c.alert ? '⚠ ' : ''}{c.label}
          <span class="chip-count">{c.count}</span>
        </button>
      {/each}
    </div>
    <div class="legend">
      <span class="leg-item" style="--lc:#CC0000">M/C Down</span>
      <span class="leg-item" style="--lc:#FD7F20">Setup Loss</span>
      <span class="leg-item" style="--lc:#5EBF33">100% Util</span>
      <span class="leg-item leg-warn" style="--lc:#CC0000">Util &lt; 80%</span>
    </div>
  </div>

  <!-- ── Machine table ───────────────────────────────────────────────────── -->
  <div class="table-wrap">
    {#if filtered.length === 0}
      <div class="empty-msg">No machines match this filter</div>
    {:else}
      <div class="table-count">{filtered.length} machines</div>
      <table class="machine-table">
        <!-- Fixed column widths -->
        <colgroup>
          <col style="width:36px">   <!-- # -->
          <col style="width:120px">  <!-- MACHINE -->
          <col style="width:54px">   <!-- WAIT↓ -->
          <col style="width:64px">   <!-- M/C DOWN -->
          <col style="width:54px">   <!-- WAIT↑ -->
          <col style="width:60px">   <!-- SETUP -->
          <col style="width:60px">   <!-- LOSS -->
          <col style="width:148px">  <!-- UTIL -->
          <col>                      <!-- EVENTS — takes remaining -->
        </colgroup>
        <thead>
          <!-- Group header row -->
          <tr class="thead-group">
            <th colspan="2"></th>
            <th colspan="2" class="grp-down">M/C DOWN</th>
            <th colspan="2" class="grp-setup">SETUP/CONVERT</th>
            <th></th>
            <th></th>
            <th></th>
          </tr>
          <!-- Column header row -->
          <tr>
            <th class="th-c">#</th>
            <th>MACHINE</th>
            <th class="th-r" style="color:#ffb3b3" title="Wait for technician">WAIT</th>
            <th class="th-r" style="color:#ff8080">REPAIR</th>
            <th class="th-r" style="color:#ffd599" title="Wait for setup start">WAIT</th>
            <th class="th-r" style="color:#ffbe6f">REPAIR</th>
            <th class="th-r">LOSS</th>
            <th>UTILIZATION</th>
            <th>EVENTS IN SHIFT</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as r, i (r.machine_id)}
            {@const uc  = utilColor(r.util_pct)}
            {@const low = r.util_pct < 85}
            {@const mid = r.util_pct < 90}
            {@const lc  = low ? '#CC0000' : r.total_loss_min > 0 ? '#FD7F20' : 'var(--color-text-disabled)'}
            <tr class:row-low={low} class:row-mid={!low && mid} class:row-alt={!low && !mid && i%2===1}>
              <td class="td-c td-muted">{i+1}</td>
              <td class="td-mc">
                <div class="mc-id">{r.machine_id} {#if low}<span class="insight-badge">⚠</span>{/if}</div>
                {#if r.package}<div class="mc-pkg">{r.package}</div>{/if}
              </td>
              <!-- DOWN group -->
              <td class="td-r td-grp-down">{#if r.wait_down_min}<span class="num-red">{r.wait_down_min}</span>{:else}<span class="num-muted">—</span>{/if}</td>
              <td class="td-r td-grp-down">{#if r.down_min}<span class="num-red">{r.down_min}</span>{:else}<span class="num-muted">—</span>{/if}</td>
              <!-- SETUP group -->
              <td class="td-r td-grp-setup">{#if r.wait_setup_min}<span class="num-org">{r.wait_setup_min}</span>{:else}<span class="num-muted">—</span>{/if}</td>
              <td class="td-r td-grp-setup">{#if r.setup_min}<span class="num-org">{r.setup_min}</span>{:else}<span class="num-muted">—</span>{/if}</td>
              <!-- LOSS -->
              <td class="td-r">
                {#if r.total_loss_min}<span style="color:{lc};font-weight:700">{r.total_loss_min}</span>
                {:else}<span class="num-muted">—</span>{/if}
              </td>
              <!-- UTILIZATION -->
              <td class="td-util">
                <div class="bar-bg"><div class="bar-fill" style="width:{Math.min(r.util_pct,100).toFixed(1)}%;background:{uc}"></div></div>
                <span class="util-pct" style="color:{uc}">{r.util_pct.toFixed(1)}%</span>
              </td>
              <!-- EVENTS — compact pills, description in tooltip -->
              <td class="td-events">
                <div class="ev-wrap">
                  {#each r.events as ev (ev.t_start+ev.job_type)}
                    {@const jt = (ev.job_type||'').toUpperCase()}
                    {@const c  = JOB_COLOR[jt] ?? {bg:'#8A8A8A',tx:'#fff'}}
                    {@const ab = JOB_ABBR[jt]  ?? jt.slice(0,6)}
                    <span class="ev-pill" style="background:{c.bg};color:{c.tx}"
                      title="{ev.job_type}{ev.des_job ? ' · '+ev.des_job : ''} · {ev.t_start}–{ev.t_end} ({ev.dur_min}m){ev.tech ? ' · '+ev.tech : ''}">
                      <span class="pill-abbr">{ab}</span>
                      <span class="pill-time">{ev.t_start}–{ev.t_end}</span>
                      {#if ev.des_job}
                        <span class="pill-desc">{ev.des_job.length > 22 ? ev.des_job.slice(0,22)+'…' : ev.des_job}</span>
                      {/if}
                      <span class="pill-dur">({ev.dur_min}m)</span>
                    </span>
                  {:else}
                    <span class="num-muted">—</span>
                  {/each}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

{:else if loading}
  <div class="state-ph"><div class="spin"></div> Loading report…</div>
{:else}
  <div class="state-ph">Select a date, shift, and package — then click <strong>Load Report</strong></div>
{/if}

<style>
  /* ── DA accent color ──────────────────────────────────────────────────── */
  :root { --da-accent: #0E7490; }   /* teal — distinct from WB blue */

  /* ── Header ──────────────────────────────────────────────────────────── */
  .wb-header {
    background: #0F172A;            /* deep navy — clean, professional */
    border-bottom: 3px solid var(--da-accent);
    padding: 14px 24px; color: #fff !important;
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
  }
  .wb-header h2 { margin:0; font-size:18px; font-weight:700; color:#fff !important; letter-spacing:-.01em; }
  .wb-header p  { margin:4px 0 0; font-size:12px; color:rgba(255,255,255,.65); font-weight:500; }
  .hdr-actions  { flex-shrink:0; }

  /* ── Filter bar ──────────────────────────────────────────────────────── */
  .filter-bar {
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border-strong);
    padding: 12px 24px;
    display: flex; align-items: flex-start; gap: 20px; flex-wrap: wrap;
  }
  .fb-group { display: flex; flex-direction: column; gap: 5px; }
  .flbl {
    font-size: 10px; font-weight: 700; color: var(--color-text-muted);
    letter-spacing: .8px; text-transform: uppercase;
    display: flex; align-items: center; gap: 6px;
  }
  .pkg-badge {
    background: var(--color-primary); color: #fff;
    font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 700;
  }

  /* Shift */
  .shift-btns { display: flex; }
  .shift-btn {
    font-size: 12px; font-weight: 600; padding: 6px 14px;
    border: 1.5px solid var(--color-border-strong); background: transparent;
    cursor: pointer; color: var(--color-text-muted); transition: all .12s;
  }
  .shift-btn:first-child { border-radius: var(--r-sm) 0 0 var(--r-sm); }
  .shift-btn:last-child  { border-radius: 0 var(--r-sm) var(--r-sm) 0; border-left: none; }
  .shift-btn.active      { background: var(--da-accent); color: #fff; border-color: var(--da-accent); }

  /* Package panel */
  .pkg-placeholder { font-size: 12px; color: var(--color-text-disabled); padding: 8px 0; font-style: italic; }
  .pkg-panel {
    border: 1px solid var(--color-border-strong); border-radius: var(--r-sm);
    background: var(--color-surface); overflow: hidden; min-width: 240px;
  }
  .pkg-search { border:none; border-bottom: 1px solid var(--color-border); border-radius:0; font-size:12px; padding:7px 10px; width:100%; }
  .pkg-list   { max-height: 160px; overflow-y: auto; }
  .pkg-item {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 5px 10px; border: none; background: transparent;
    cursor: pointer; font-size: 12px; color: var(--color-text-dark);
    text-align: left; transition: background .08s;
  }
  .pkg-item:hover  { background: var(--color-surface-alt); }
  .pkg-item.active { background: #ECFEFF; color: var(--da-accent); font-weight: 600; }
  .pkg-check { width: 14px; font-size: 11px; font-weight: 700; color: var(--da-accent); flex-shrink: 0; }
  .pkg-footer {
    display: flex; align-items: center; gap: 6px; padding: 6px 10px;
    border-top: 1px solid var(--color-border); background: var(--color-surface-alt);
  }
  .pkg-quick {
    font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px;
    border: 1px solid var(--color-border-strong); background: transparent;
    cursor: pointer; color: var(--color-primary); transition: all .1s;
  }
  .pkg-quick:hover { background: var(--da-accent); color: #fff; border-color: var(--da-accent); }
  .pkg-count { font-size: 11px; color: var(--color-text-disabled); margin-left: auto; }

  /* Buttons */
  .btn-load {
    background: var(--da-accent); color: #fff; border: none;
    border-radius: var(--r-sm); padding: 7px 20px; font-size: 13px;
    font-weight: 700; cursor: pointer; transition: opacity .12s; white-space: nowrap;
  }
  .btn-load:disabled { opacity: .45; cursor: not-allowed; }
  .btn-export {
    background: var(--da-accent); color: #fff;
    border: none; border-radius: var(--r-sm);
    padding: 6px 14px; font-size: 12px; font-weight: 700;
    cursor: pointer; transition: opacity .12s;
  }
  .btn-export:hover  { opacity: .85; }
  .btn-export:disabled { opacity: .4; cursor: not-allowed; }

  /* Error */
  .err-banner {
    background: #FFF0F0; border-bottom: 2px solid var(--status-down);
    color: var(--status-down); font-weight: 600; padding: 10px 24px; font-size: 13px;
  }

  /* ── KPI section — 2 rows ────────────────────────────────────────────── */
  .kpi-section {
    display: flex; flex-direction: column; gap: 0;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }

  /* Row 1: Fleet — horizontal stat strip */
  .fleet-row {
    display: flex; align-items: stretch; gap: 6px; flex-wrap: wrap;
    padding: 10px 20px;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }
  .fleet-stat {
    display: flex; align-items: baseline; gap: 6px;
    background: var(--color-surface-alt);
    border-left: 3px solid var(--c);
    border-radius: var(--r-sm);
    padding: 6px 14px; flex-shrink: 0;
    min-height: 44px;
  }
  .fs-val { font-size: 20px; font-weight: 800; color: var(--c); font-variant-numeric: tabular-nums; line-height: 1; align-self: center; }
  .fs-lbl { font-size: 10px; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .3px; align-self: center; }
  .fs-delta { font-size: 11px; font-weight: 700; align-self: center; padding: 1px 5px; border-radius: 3px; }
  .fs-delta.up  { background: #E8F5E9; color: #2E7D32; }
  .fs-delta.dn  { background: #FFEBEE; color: #C62828; }
  .kpi7d-note { font-size: 9px; font-weight: 600; color: var(--color-text-disabled); align-self: center; margin-left: auto; white-space: nowrap; }
  /* vs avg badge on loss KPI cards */
  .kc-vs { font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; display: inline-block; margin-bottom: 2px; }
  .kc-vs.vs-good { background: #E8F5E9; color: #2E7D32; }
  .kc-vs.vs-bad  { background: #FFEBEE; color: #C62828; }
  .kc-ev-delta { font-size: 10px; font-weight: 700; margin-left: 3px; }
  .kc-ev-delta.ev-good { color: #2E7D32; }
  .kc-ev-delta.ev-bad  { color: #C62828; }
  /* Narrative */
  .narrative-card {
    background: var(--color-surface); border: 1px solid var(--color-border-strong);
    border-left: 4px solid #4A90D9;
    border-radius: var(--r-sm); padding: 14px 18px; margin-bottom: 12px;
  }
  .narrative-hdr { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--color-text-heading); margin-bottom: 8px; }
  .narrative-icon { font-size: 16px; }
  .narrative-badge { font-size: 10px; font-weight: 700; background: #E3F0FB; color: #1A3A6C; border-radius: 10px; padding: 2px 8px; margin-left: 4px; }
  .narrative-body { font-size: 13px; line-height: 1.7; color: var(--color-text-body, #334); }

  /* Row 2: Shift Loss % */
  .loss-row {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 12px 20px;
    background: var(--color-surface-alt);
  }
  .kpi-block-label {
    font-size: 9px; font-weight: 800; letter-spacing: 1.2px;
    text-transform: uppercase; color: var(--color-text-disabled);
    flex-shrink: 0; padding-top: 6px;  /* align with card top */
    writing-mode: horizontal-tb;
  }

  .kpi-row-cards { display: flex; gap: 8px; flex: 1; align-items: stretch; }

  /* Fleet cards — compact number + label */
  .kc {
    display: flex; flex-direction: column; align-items: flex-start;
    background: var(--color-surface); border-radius: var(--r-sm);
    border-left: 3px solid var(--c);
    padding: 10px 12px; flex: 1; min-width: 0;
    box-shadow: 0 1px 3px rgba(0,0,0,.06);
    position: relative; overflow: hidden;
  }
  .kc-lbl  { font-size: 10px; font-weight: 700; color: var(--color-text-muted); margin-top: 2px; letter-spacing: .4px; text-transform: uppercase; }

  /* Loss cards */
  .kc-pct  { font-size: 22px; font-weight: 800; color: var(--c); line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .kc-meta-col { flex-direction: column !important; align-items: flex-start !important; gap: 2px !important; }
  .wait-row    { display: flex; align-items: center; gap: 5px; }
  .wait-tag    { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--color-text-disabled); width: 30px; flex-shrink: 0; }
  .idle-row    { display: flex; align-items: center; justify-content: space-between; gap: 4px; width: 100%; }
  .idle-crit   { font-size: 9px; color: var(--color-text-muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .idle-stats  { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .idle-ev     { font-size: 9px; color: var(--color-text-disabled); }
  .kc-total {
    font-size: 10px; color: var(--color-text-muted);
    margin-top: 4px; padding-top: 4px;
    border-top: 1px dashed var(--color-border);
    white-space: nowrap;
  }
  .kc-total b { font-weight: 700; }

  .kc-meta {
    display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
    margin-top: 5px; padding-top: 5px;
    border-top: 1px solid var(--color-border);
    width: 100%;
  }
  .kc-ev   { font-size: 10px; color: var(--color-text-muted); white-space: nowrap; }
  .kc-dot  { font-size: 10px; color: var(--color-text-disabled); }
  .kc-rate { font-size: 10px; color: var(--color-text-muted); white-space: nowrap; }
  .kc-rate b { color: var(--c); font-weight: 700; }

  /* Hover tooltip on loss cards */
  .kc-hoverable { position: relative; cursor: default; }
  .kc-hoverable:hover { box-shadow: 0 4px 16px rgba(0,0,0,.14); z-index: 10; }

  .loss-tooltip {
    display: none;
    position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%);
    background: #fff; border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm); box-shadow: 0 6px 20px rgba(0,0,0,.15);
    padding: 10px 14px; min-width: 200px; z-index: 100;
    pointer-events: none;
  }
  .loss-tooltip::before {
    content: ''; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
    border: 6px solid transparent; border-bottom-color: var(--color-border-strong);
  }
  .loss-tooltip::after {
    content: ''; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
    margin-bottom: -1px;
    border: 5px solid transparent; border-bottom-color: #fff;
  }
  .kc-hoverable:hover .loss-tooltip { display: block; }

  .tt-title    { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 8px; }
  .tt-row      { display: flex; align-items: center; gap: 6px; padding: 4px 0 2px; }
  .tt-rank     { font-size: 10px; font-weight: 700; color: var(--color-text-disabled); width: 20px; flex-shrink: 0; }
  .tt-mc       { font-size: 12px; font-weight: 700; color: var(--da-accent); flex: 1; }
  .tt-val      { font-size: 12px; font-weight: 700; white-space: nowrap; }
  .tt-criteria {
    font-size: 11px; color: var(--color-text-muted); font-style: italic;
    padding: 0 0 5px 26px;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 2px;
  }
  .tt-row:last-child + .tt-criteria,
  .tt-row-criteria:last-child { border-bottom: none; }
  /* SBO row: criteria is the main content */
  .tt-row-criteria .tt-crit {
    font-size: 12px; font-weight: 600; color: var(--color-text-dark); flex: 1;
  }

  /* ── Chip bar ─────────────────────────────────────────────────────────── */
  .chip-bar {
    padding: 10px 24px; background: var(--color-surface);
    border-bottom: 1px solid var(--color-border-strong);
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  }
  .chip-left { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .show-lbl  { font-size: 10px; font-weight: 700; color: var(--color-text-muted); letter-spacing: 1px; margin-right: 4px; }
  .chip-btn {
    display: flex; align-items: center; gap: 5px;
    font-size: 12px; font-weight: 700; padding: 4px 12px;
    border-radius: 12px; border: 1.5px solid var(--da-accent);
    background: transparent; color: var(--da-accent); cursor: pointer; transition: all .1s;
  }
  .chip-btn.active     { background: var(--da-accent); color: #fff; }
  .chip-btn.alert-chip { border-color: var(--status-down); color: var(--status-down); }
  .chip-btn.alert-chip.active { background: var(--status-down); color: #fff; }
  .chip-count {
    background: rgba(0,0,0,.1); border-radius: 8px;
    padding: 0 6px; font-size: 11px; font-weight: 700;
  }
  .chip-btn.active .chip-count { background: rgba(255,255,255,.25); }

  .legend { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
  .leg-item {
    font-size: 11px; font-weight: 600; color: var(--color-text-muted);
    display: flex; align-items: center; gap: 4px;
  }
  .leg-item::before { content:'●'; color: var(--lc); font-size: 10px; }
  .leg-warn { font-style: italic; }

  /* ── Machine table ───────────────────────────────────────────────────── */
  .table-wrap { padding: 16px 24px; overflow-x: auto; background: var(--color-surface-alt); }
  .empty-msg  { padding: 40px; text-align: center; color: var(--color-text-muted); font-size: 14px; }

  .table-count { font-size: 12px; color: var(--color-text-muted); margin-bottom: 6px; }

  .machine-table {
    width: 100%; border-collapse: collapse; table-layout: fixed;
    background: var(--color-surface);
    box-shadow: 0 2px 8px rgba(0,0,0,.08);
    border-radius: var(--r-sm); overflow: hidden;
  }

  /* Group header row */
  .thead-group { background: #0a2347; }
  .thead-group th { padding: 4px 8px; font-size: 10px; font-weight: 700; letter-spacing: .8px; color: rgba(255,255,255,.5); }
  .grp-down  { text-align: center; color: #ffb3b3 !important; border-bottom: 1px solid rgba(204,0,0,.4); border-left: 1px solid rgba(255,255,255,.1); border-right: 1px solid rgba(255,255,255,.1); }
  .grp-setup { text-align: center; color: #ffd599 !important; border-bottom: 1px solid rgba(253,127,32,.4); border-left: 1px solid rgba(255,255,255,.1); border-right: 1px solid rgba(255,255,255,.1); }

  /* Column header row */
  .machine-table thead tr:last-child { background: #0F172A; }
  .machine-table th {
    padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 700;
    letter-spacing: .4px; white-space: nowrap; color: #fff; user-select: none;
  }
  .th-c  { text-align: center !important; }
  .th-r  { text-align: right !important; }

  /* DOWN/SETUP group column tinting */
  .td-grp-down  { background: rgba(204,0,0,.03); border-left: 1px solid rgba(204,0,0,.08); }
  .td-grp-setup { background: rgba(253,127,32,.03); border-left: 1px solid rgba(253,127,32,.08); }

  .machine-table td {
    padding: 6px 10px; font-size: 12px;
    border-bottom: 1px solid var(--color-border); vertical-align: middle;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row-low  { background: #fff0f0 !important; }
  .row-mid  { background: #fff8ee !important; }
  .row-alt  { background: var(--color-surface-alt); }

  .td-c     { text-align: center; }
  .td-r     { text-align: right; }
  .td-muted { color: var(--color-text-disabled); font-size: 11px; }
  .td-mc    { overflow: visible; white-space: normal; }
  .td-util  { overflow: visible; white-space: normal; }
  .td-events{ overflow: visible; white-space: normal; }

  .mc-id  { font-weight: 700; color: var(--da-accent); font-size: 12px; }
  .mc-pkg { font-size: 10px; color: var(--color-text-disabled); margin-top: 1px; }
  .insight-badge {
    display: inline-block; background: #ffebeb; color: var(--status-down);
    border: 1px solid var(--status-down); border-radius: 3px;
    font-size: 9px; font-weight: 700; padding: 0 4px; margin-left: 5px; vertical-align: middle;
  }

  .num-red  { color: #CC0000; font-weight: 700; }
  .num-org  { color: #FD7F20; font-weight: 700; }
  .num-muted{ color: var(--color-text-disabled); }

  .bar-bg   { width: 100%; height: 7px; background: var(--color-border); border-radius: 3px; margin-bottom: 3px; }
  .bar-fill { height: 7px; border-radius: 3px; transition: width .3s; }
  .util-pct { font-weight: 700; font-size: 12px; }

  /* Events column — compact pills, description only in tooltip */
  .ev-wrap { display: flex; flex-wrap: wrap; gap: 3px; }
  .ev-pill {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 2px 6px; border-radius: 4px;
    font-size: 10px; font-weight: 600; white-space: nowrap;
    cursor: default; line-height: 1.4;
  }
  .pill-abbr { font-weight: 700; letter-spacing: .3px; }
  .pill-time { opacity: .85; font-weight: 500; font-size: 9px; }
  .pill-desc { opacity: .9; font-weight: 500; font-size: 10px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill-dur  { opacity: .7; font-weight: 500; font-size: 9px; }

  /* ── State placeholders ──────────────────────────────────────────────── */
  .state-ph {
    padding: 64px 24px; text-align: center;
    color: var(--color-text-muted); font-size: 15px;
    background: var(--color-surface-alt);
    display: flex; align-items: center; justify-content: center; gap: 10px;
  }
  .spin {
    width: 18px; height: 18px; border: 2px solid var(--color-border);
    border-top-color: var(--color-primary); border-radius: 50%;
    animation: spin .7s linear infinite; flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
