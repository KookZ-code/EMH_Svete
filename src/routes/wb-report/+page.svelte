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
  interface WbKpi {
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
  let kpi          = $state<WbKpi|null>(null);
  let kpi7d        = $state<Partial<WbKpi> & { days: number; down_events?: number; setup_events?: number; idle_pct?: number } | null>(null);
  let pkgLabel     = $state('');
  let timeRange    = $state('');
  let loading      = $state(false);
  let error        = $state<string|null>(null);
  let chip         = $state('ALL');
  let pkgSearch    = $state('');
  let hmMode       = $state<'ev'|'min'>('ev');

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
    if (chip === '<85%')  return machines.filter(r => r.util_pct < 85);
    return machines;
  });

  const chipCounts = $derived({
    ALL:   machines.length,
    DOWN:  machines.filter(r => r.down_min > 0).length,
    SETUP: machines.filter(r => r.down_min === 0 && r.setup_min + r.wait_setup_min > 0).length,
    FULL:  machines.filter(r => r.total_loss_min === 0).length,
    '<85%': machines.filter(r => r.util_pct < 85).length,
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
      const res = await fetch(`${base}/api/wb/packages?date=${selDate}`);
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
      const pkgsEnc = encodeURIComponent(selPackages.join(','));
      const main = await fetch(`${base}/api/wb/report?date=${selDate}&shift=${selShift}&packages=${pkgsEnc}`).then(r => r.json());
      if (main.error) { error = main.error.message; loading = false; return; }
      const d = main.data;
      machines  = d.machines   ?? [];
      kpi       = d.kpi        ?? null;
      pkgLabel  = d.pkg_label  ?? '';
      timeRange = d.time_range ?? '';
      chip      = 'ALL';

      // Detect actual shift from timeRange — same bug-fix as DA report
      const startHour = timeRange.match(/^(\d{1,2}):/)?.[1];
      const actualShift = startHour && parseInt(startHour) >= 12 ? 'Night' : selShift;

      const base7 = Array.from({ length: 7 }, (_, i) => {
        const dt = new Date(selDate); dt.setDate(dt.getDate() - (i + 1));
        return dt.toISOString().slice(0, 10);
      });
      const hist = await Promise.all(
        base7.map(dt => fetch(`${base}/api/wb/report?date=${dt}&shift=${actualShift}&packages=${pkgsEnc}`)
          .then(r => r.json()).catch(() => null))
      );

      const DOWN_T  = new Set(['M/C DOWN','ENGINEERING DOWN','FACILITY DOWN']);
      const SETUP_T = new Set(['SETUP','CONVERT','CLEAN MOLD','CHANGE CAP']);
      const valid = hist.filter(h => h?.data?.kpi?.total > 0);
      if (valid.length > 0) {
        const kpis = valid.map(h => h.data.kpi as WbKpi);
        const avg = <T extends keyof WbKpi>(k: T) =>
          Math.round(kpis.reduce((s, v) => s + (v[k] as number), 0) / kpis.length * 10) / 10;
        const downEvts  = valid.map(h => (h.data.machines as MachineRow[]).reduce((s, m) =>
          s + m.events.filter(e => DOWN_T.has((e.job_type||'').toUpperCase())).length, 0));
        const setupEvts = valid.map(h => (h.data.machines as MachineRow[]).reduce((s, m) =>
          s + m.events.filter(e => SETUP_T.has((e.job_type||'').toUpperCase())).length, 0));
        const avgArr = (arr: number[]) => Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
        const idlePcts = valid.map(h => {
          const ms = h.data.machines as MachineRow[];
          const fleetMin = ms.length * 720 || 1;
          const idleMin  = ms.reduce((s, m) =>
            s + m.events.filter(e =>
              (e.job_type||'').toUpperCase() === 'SETUP BY OPERATOR' &&
              /^(idle|wait\s)/i.test(e.des_job||'')
            ).reduce((sm, e) => sm + (e.dur_min||0), 0), 0);
          return Math.round(idleMin / fleetMin * 100 * 10) / 10;
        });
        kpi7d = {
          days: valid.length,
          avg_util: avg('avg_util'), down_pct: avg('down_pct'), wait_pct: avg('wait_pct'),
          setup_conv_pct: avg('setup_conv_pct'), sbo_pct: avg('sbo_pct'),
          n_down: avg('n_down'), n_tech: avg('n_tech'), n_low: avg('n_low'), n_full: avg('n_full'),
          down_events: avgArr(downEvts), setup_events: avgArr(setupEvts),
          idle_pct: Math.round(idlePcts.reduce((s,v)=>s+v,0)/idlePcts.length*10)/10,
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
    const fm = n * 720 || 1;

    function dlt(cur:number, avg:number|undefined, good:(d:number)=>boolean) {
      if (avg == null) return '';
      const d = Math.round((cur - avg) * 10) / 10;
      const sign = d > 0 ? '+' : '';
      const col  = good(d) ? '#2E7D32' : '#C62828';
      const bg   = good(d) ? '#E8F5E9' : '#FFEBEE';
      return `<span style="font-size:10px;font-weight:700;background:${bg};color:${col};border-radius:3px;padding:1px 5px;margin-left:4px">${sign}${d}</span>`;
    }
    function vsAvg(cur:number, avg:number|undefined, lowerBetter=false) {
      if (avg == null) return '';
      const d = Math.round((cur - avg) * 10) / 10;
      const sign = d > 0 ? '+' : '';
      const good = lowerBetter ? d < 0 : d > 0;
      const col  = good ? '#2E7D32' : '#C62828';
      const bg   = good ? '#E8F5E9' : '#FFEBEE';
      return `<div style="font-size:10px;font-weight:700;background:${bg};color:${col};border-radius:3px;padding:1px 5px;display:inline-block;margin-bottom:3px">${sign}${d}% vs avg</div>`;
    }
    function fc(val:string, lbl:string, col:string, delta='') {
      return `<div style="background:#F8FAFC;border-left:3px solid ${col};border-radius:6px;padding:10px 16px;flex:1;min-width:100px">
        <div style="font-size:22px;font-weight:800;color:${col};line-height:1">${val}</div>
        <div style="display:flex;align-items:center;gap:4px;margin-top:3px">
          <span style="font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.3px">${lbl}</span>${delta}
        </div></div>`;
    }
    function lc2(pct:string, lbl:string, col:string, meta:string, total:string, vsAvgBadge='') {
      return `<div style="background:#fff;border-left:3px solid ${col};border-radius:6px;padding:12px 16px;flex:1;min-width:110px">
        <div style="font-size:24px;font-weight:800;color:${col};line-height:1">${pct}</div>
        ${vsAvgBadge}
        <div style="font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.4px;margin-top:2px">${lbl}</div>
        <div style="font-size:11px;color:#888;margin-top:6px">${meta}</div>
        <div style="font-size:11px;color:${col};font-weight:700;margin-top:4px">${total}</div>
      </div>`;
    }

    const n_down = rows.filter(r=>r.down_min>0).length;
    const avg_u  = n ? (rows.reduce((s,r)=>s+r.util_pct,0)/n).toFixed(1) : '0';
    const uc     = parseFloat(avg_u)>=90?'#5EBF33':parseFloat(avg_u)>=85?'#FD7F20':'#CC0000';
    const n_low  = rows.filter(r=>r.util_pct<85).length;

    const fleetRow = `<div style="display:flex;gap:8px;padding:10px 24px;background:#fff;border-bottom:1px solid #e0e0e0">
      <span style="font-size:9px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#aaa;width:88px;flex-shrink:0;display:flex;align-items:center">FLEET</span>
      <div style="display:flex;gap:8px;flex:1">
        ${fc(String(n), 'Machines', '#0E3689')}
        ${fc(String(n_down), 'M/C Down', '#CC0000', dlt(n_down, kpi7d?.n_down, d=>d<0))}
        ${fc(avg_u+'%', 'Avg Util', uc, dlt(parseFloat(avg_u), kpi7d?.avg_util, d=>d>0)+'%')}
        ${fc(String(n_low), 'Util &lt;85%', '#CC0000', dlt(n_low, kpi7d?.n_low, d=>d<0))}
        ${fc(String(kpi?.n_tech??0), 'Techs', '#702076')}
        ${kpi7d ? `<span style="font-size:9px;color:#aaa;align-self:flex-end;padding-bottom:8px;white-space:nowrap">vs ${kpi7d.days}d avg</span>` : ''}
      </div>
    </div>`;

    const idlePct = lossStats.idle.pct.toFixed(1);
    const lossRow = `<div style="display:flex;gap:8px;padding:10px 24px;background:#F8FAFC;border-bottom:1px solid #e0e0e0">
      <span style="font-size:9px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#aaa;width:88px;flex-shrink:0;display:flex;align-items:center;white-space:nowrap">SHIFT LOSS %</span>
      <div style="display:flex;gap:8px;flex:1">
        ${lc2(kpi?.down_pct+'%','Down Time','#CC0000',`${lossStats.down.events} ev · MTTR ${fmtMtx(lossStats.down.mttr)}`,`Total ${fmtMtx(lossStats.down.totalMin)}`,vsAvg(kpi?.down_pct??0,kpi7d?.down_pct,true))}
        ${lc2(kpi?.wait_pct+'%','Wait','#FD7F20',`Down MTTW ${fmtMtx(lossStats.wait.mttwDown)} · Setup MTTW ${fmtMtx(lossStats.wait.mttwSetup)}`,`Total ${fmtMtx(lossStats.wait.totalMin)}`,vsAvg(kpi?.wait_pct??0,kpi7d?.wait_pct,true))}
        ${lc2(kpi?.setup_conv_pct+'%','Setup+Conv','#1D9CE4',`${lossStats.setup.events} ev · MTTR ${fmtMtx(lossStats.setup.mttr)}`,`Total ${fmtMtx(lossStats.setup.totalMin)}`,vsAvg(kpi?.setup_conv_pct??0,kpi7d?.setup_conv_pct,true))}
        ${lc2(kpi?.sbo_pct+'%','SBO','#00897B',`${lossStats.sbo.events} ev · MTTR ${fmtMtx(lossStats.sbo.mttr)}`,`Total ${fmtMtx(lossStats.sbo.totalMin)}`)}
        ${lc2(idlePct+'%','Idle','#8B5CF6',lossStats.idle.top3.map(t=>`${t.criteria.slice(0,18)}: ${t.count}ev`).join(' / '),`Total ${fmtMtx(lossStats.idle.totalMin)}`,vsAvg(lossStats.idle.pct,kpi7d?.idle_pct,true))}
      </div>
    </div>`;

    const narrativeHtml = narrative ? `<div style="background:#fff;border-left:4px solid #4A90D9;border-radius:6px;padding:14px 18px;margin:12px 24px;font-size:13px;line-height:1.7;color:#334">
      <div style="font-size:12px;font-weight:700;color:#1A3A5C;margin-bottom:6px">📋 Narrative Insight${kpi7d ? ` <span style="font-size:10px;font-weight:600;background:#E3F0FB;color:#1A3A6C;border-radius:8px;padding:1px 7px">vs ${kpi7d.days}-day avg</span>` : ''}</div>
      ${narrative}
    </div>` : '';

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

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>WB Report — ${d_fmt} ${selShift}</title>
    <style>body{font-family:'Segoe UI',Calibri,Arial,sans-serif;margin:0;background:#f7f7f7}@media print{body{background:#fff}}</style></head>
    <body>
    <div style="background:linear-gradient(135deg,#0E3689 0%,#1a4a9e 100%);padding:16px 28px;color:#fff">
      <div style="font-size:20px;font-weight:700;margin-bottom:4px">Wire Bond — Utilization &amp; Downtime Report</div>
      <div style="font-size:13px;opacity:.85">${selShift} Shift &nbsp;·&nbsp; ${d_fmt} &nbsp;·&nbsp; ${timeRange} &nbsp;·&nbsp; ${pkgLabel} &nbsp;·&nbsp; ${n} machines</div>
    </div>
    ${fleetRow}
    ${lossRow}
    ${narrativeHtml}
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
    a.href = url; a.download = `wb_report_${selDate}_${selShift}.html`; a.click();
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

  // SBO events classified as IDLE: des_job starts with "Idle" or "Wait ..."
  function isIdleEvent(desJob: string): boolean {
    const d = (desJob || '').trim().toLowerCase();
    return d.startsWith('idle') || d.startsWith('wait ');
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

  function fmtMtx(min: number): string {
    if (!min) return '—';
    if (min < 60) return `${min}m`;
    return `${Math.floor(min/60)}h ${min%60}m`;
  }

  // ── 7d delta helpers ──────────────────────────────────────────────────────
  function delta(cur: number, avg: number | undefined, higherIsBetter = true) {
    if (avg == null) return null;
    const d = Math.round((cur - avg) * 10) / 10;
    if (d === 0) return { txt: '→ same', good: true };
    const sign = d > 0 ? '+' : '';
    return { txt: `${sign}${d}`, good: higherIsBetter ? d > 0 : d < 0 };
  }
  function deltaN(cur: number, avg: number | undefined, higherIsBetter = false) {
    return delta(cur, avg, higherIsBetter);
  }

  const kd = $derived.by(() => {
    if (!kpi || !kpi7d) return null;
    return {
      n_down:      delta(kpi.n_down,         kpi7d.n_down,         false),
      avg_util:    delta(kpi.avg_util,        kpi7d.avg_util,       true),
      n_tech:      delta(kpi.n_tech,          kpi7d.n_tech,         false),
      n_low:       delta(kpi.n_low,           kpi7d.n_low,          false),
      n_full:      delta(kpi.n_full,          kpi7d.n_full,         true),
      down_pct:    delta(kpi.down_pct,        kpi7d.down_pct,       false),
      wait_pct:    delta(kpi.wait_pct,        kpi7d.wait_pct,       false),
      setup:       delta(kpi.setup_conv_pct,  kpi7d.setup_conv_pct, false),
      down_events: deltaN(lossStats.down.events,  kpi7d.down_events,  false),
      setup_events:deltaN(lossStats.setup.events, kpi7d.setup_events, false),
      idle_pct:    delta(lossStats.idle.pct,       kpi7d.idle_pct,    false),
    };
  });

  // ── Heatmap — hourly event buckets (same logic as DA, bugs fixed) ─────────
  interface HmBucket { ev: number; min: number; }
  interface HmRow    { key: string; label: string; baseRgb: string; hours: HmBucket[]; state: number[]; }

  const heatmap = $derived.by((): { shiftHours: number[]; rows: HmRow[]; totalState: number[] } | null => {
    if (!machines.length) return null;
    // Use timeRange to determine actual shift hours (bug fix: don't trust selShift label)
    const startHourMatch = timeRange.match(/^(\d{1,2}):/);
    const startHour = startHourMatch ? parseInt(startHourMatch[1]) : (selShift === 'Night' ? 19 : 7);
    const isNight   = startHour >= 12;
    const shiftHours = isNight ? [19,20,21,22,23,0,1,2,3,4,5,6] : [7,8,9,10,11,12,13,14,15,16,17,18];

    const DOWN_T  = new Set(['M/C DOWN','ENGINEERING DOWN','FACILITY DOWN']);
    const SETUP_T = new Set(['SETUP','CONVERT','CLEAN MOLD','CHANGE CAP']);

    type Cat = 'down' | 'setup' | 'sbo';
    const buckets: Record<number, Record<Cat, HmBucket>> = {};
    for (const h of shiftHours) buckets[h] = { down:{ev:0,min:0}, setup:{ev:0,min:0}, sbo:{ev:0,min:0} };

    const toShiftMin = (t: string): number | null => {
      if (!t) return null;
      const [hh, mm] = t.split(':').map(Number);
      if (isNaN(hh) || isNaN(mm)) return null;
      const abs = hh * 60 + mm;
      return abs >= startHour * 60 ? abs - startHour * 60 : abs + (24 - startHour) * 60;
    };

    const stateDown  = new Array(shiftHours.length).fill(0);
    const stateSetup = new Array(shiftHours.length).fill(0);

    for (const m of machines) {
      const machineDownAt  = new Set<number>();
      const machineSetupAt = new Set<number>();
      for (const e of m.events) {
        if (!e.t_start) continue;
        const jt  = (e.job_type || '').toUpperCase();
        const dur = e.dur_min || 0;
        const hr  = parseInt(e.t_start.split(':')[0]);
        const isDown  = DOWN_T.has(jt);
        const isSetup = SETUP_T.has(jt);
        if (hr in buckets) {
          if (isDown)                        { buckets[hr].down.ev++;  buckets[hr].down.min  += dur; }
          else if (isSetup)                  { buckets[hr].setup.ev++; buckets[hr].setup.min += dur; }
          else if (jt === 'SETUP BY OPERATOR') { buckets[hr].sbo.ev++; buckets[hr].sbo.min += dur; }
        }
        if (!isDown && !isSetup) continue;
        const eStart = toShiftMin(e.t_start);
        if (eStart === null) continue;
        const rawEnd = !e.t_end ? null : toShiftMin(e.t_end);
        const eEnd   = rawEnd == null ? 9999 : rawEnd < eStart ? rawEnd + shiftHours.length * 60 : rawEnd;
        shiftHours.forEach((h, idx) => {
          const hMin = toShiftMin(`${String(h).padStart(2,'0')}:00`) ?? idx * 60;
          if (eStart < hMin + 60 && eEnd > hMin) {
            if (isDown)  machineDownAt.add(idx);
            if (isSetup) machineSetupAt.add(idx);
          }
        });
      }
      machineDownAt.forEach(idx  => stateDown[idx]++);
      machineSetupAt.forEach(idx => stateSetup[idx]++);
    }

    const rowDefs: { key: Cat; label: string; baseRgb: string }[] = [
      { key:'down',  label:'M/C DOWN',   baseRgb:'204,0,0'    },
      { key:'setup', label:'SETUP+CONV', baseRgb:'29,156,228' },
      { key:'sbo',   label:'SBO',        baseRgb:'23,162,184' },
    ];
    const rows: HmRow[] = rowDefs.map(({ key, label, baseRgb }) => ({
      key, label, baseRgb,
      hours: shiftHours.map(h => ({ ...buckets[h][key as Cat] })),
      state: key === 'down' ? stateDown : key === 'setup' ? stateSetup : [],
    }));
    const totalState = shiftHours.map((_, i) => stateDown[i] + stateSetup[i]);
    return { shiftHours, rows, totalState };
  });

  function hmIntensity(val: number, rowMax: number) { return Math.round((val / rowMax * 90 + 8) / 100 * 100) / 100; }
  function hmCellBg(val: number, rowMax: number, rgb: string) { return `rgba(${rgb},${hmIntensity(val, Math.max(rowMax,1))})`; }
  function hmTextColor(val: number, rowMax: number)           { return hmIntensity(val, Math.max(rowMax,1)) > 0.5 ? '#fff' : '#1a1a2e'; }
  function hmFmt(b: HmBucket) {
    return hmMode === 'ev' ? String(b.ev) : b.min >= 60 ? `${Math.floor(b.min/60)}h${b.min%60?b.min%60+'m':''}` : `${b.min}m`;
  }
  function hmRowMax(row: HmRow) { return Math.max(...row.hours.map(h => hmMode==='ev' ? h.ev : h.min), 1); }
  function hmHour(h: number)    { return `${String(h).padStart(2,'0')}:00`; }

  // TOTAL column — authoritative from lossStats (matches KPI cards); marks overlap with *
  function hmTotal(row: HmRow): string {
    if (hmMode === 'ev') {
      const auth = row.key==='down' ? lossStats.down.events : row.key==='setup' ? lossStats.setup.events : lossStats.sbo.events;
      const inW  = row.hours.reduce((s,h)=>s+h.ev,0);
      return (auth - inW) > 0 ? `${auth} ev*` : `${auth} ev`;
    }
    const min = row.key==='down' ? lossStats.down.totalMin : row.key==='setup' ? lossStats.setup.totalMin : lossStats.sbo.totalMin;
    return min >= 60 ? `${Math.floor(min/60)}h ${min%60}m` : `${min}m`;
  }

  // ── Narrative Insight ─────────────────────────────────────────────────────
  const narrative = $derived.by(() => {
    if (!kpi || machines.length === 0) return null;
    const shiftMin = machines.length * 720;
    const totalLoss = machines.reduce((s,m)=>s+m.total_loss_min, 0);
    const topFailures = (() => {
      const map = new Map<string, number>();
      for (const m of machines)
        for (const e of m.events)
          if (['M/C DOWN','ENGINEERING DOWN','FACILITY DOWN'].includes((e.job_type||'').toUpperCase())) {
            const k = (e.des_job||'').split(',')[0].trim() || e.job_type;
            map.set(k, (map.get(k) ?? 0) + 1);
          }
      return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3);
    })();

    const avgVs7d = kpi7d ? (kpi.avg_util - (kpi7d.avg_util ?? kpi.avg_util)) : null;
    const trendTxt = avgVs7d == null ? '' :
      avgVs7d > 1  ? ` สูงกว่าค่าเฉลี่ย ${kpi7d!.days} วันที่ผ่านมา (${kpi7d!.avg_util}%)` :
      avgVs7d < -1 ? ` ต่ำกว่าค่าเฉลี่ย ${kpi7d!.days} วันที่ผ่านมา (${kpi7d!.avg_util}%)` :
      ` ใกล้เคียงค่าเฉลี่ย ${kpi7d!.days} วัน (${kpi7d!.avg_util}%)`;

    const belowNote = `เครื่องที่ util ต่ำกว่า 85% มีถึง ${machines.filter(m=>m.util_pct<85).length} เครื่อง คิดเป็นสูญเสียกำลังการผลิตสุทธิ ${Math.round(totalLoss/shiftMin*100)}% ของ machine-hour ทั้งหมด`;
    const failureSummary = topFailures.length
      ? `สาเหตุ down ที่พบบ่อยที่สุดคือ "${topFailures[0][0]}" (${topFailures[0][1]} ครั้ง)` +
        (topFailures[1] ? ` รองลงมาคือ "${topFailures[1][0]}" (${topFailures[1][1]} ครั้ง)` : '') + ' '
      : '';
    const waitNote  = kpi.wait_pct >= 7 ? `เวลารอช่าง ${kpi.wait_pct}% คิดเป็นกว่า 2 เท่าของเวลา down จริง — ควรพิจารณาเพิ่ม coverage ช่างในช่วง peak load ` : '';
    const setupNote = kpi.setup_conv_pct >= 6 ? `Setup+Convert สูงถึง ${kpi.setup_conv_pct}%${kd?.setup ? (kd.setup.good ? ' (ลดลงจาก avg)' : ' (เพิ่มขึ้นจาก avg)') : ''} ` : '';
    const colletNote = topFailures[0]?.[0]?.toUpperCase().includes('COLLET')
      ? `พบ MAX COLLET COUNT ถึง ${topFailures[0][1]} ครั้ง — ควรวางแผน batch replacement ก่อน shift ถัดไป ` : '';

    // Worst package + top failure reasons that caused the loss
    const pkgLoss = new Map<string, { lossMin: number; mids: string[] }>();
    for (const m of machines) {
      const pkg = m.package || 'Unknown';
      const prev = pkgLoss.get(pkg) ?? { lossMin: 0, mids: [] };
      prev.lossMin += m.total_loss_min;
      if (m.total_loss_min > 0) prev.mids.push(m.machine_id);
      pkgLoss.set(pkg, prev);
    }
    const worstPkg = [...pkgLoss.entries()].filter(([p])=>p!=='Unknown').sort((a,b)=>b[1].lossMin-a[1].lossMin)[0];
    let pkgNote = '';
    if (worstPkg) {
      const [pkgName, pkgData] = worstPkg;
      const pkgTotalH = Math.round(pkgData.lossMin / 60 * 10) / 10;
      const reasonMap = new Map<string, number>();
      const DOWN_PKG  = new Set(['M/C DOWN','ENGINEERING DOWN','FACILITY DOWN']);
      const SETUP_PKG = new Set(['SETUP','CONVERT','CLEAN MOLD','CHANGE CAP']);
      for (const m of machines) {
        if ((m.package || 'Unknown') !== pkgName) continue;
        for (const e of m.events) {
          const jt = (e.job_type || '').toUpperCase();
          const isDown  = DOWN_PKG.has(jt);
          const isSetup = SETUP_PKG.has(jt);
          const isIdle  = jt === 'SETUP BY OPERATOR' && isIdleEvent(e.des_job);
          if (!isDown && !isSetup && !isIdle) continue;
          const cat  = isDown ? 'DOWN' : isSetup ? 'SETUP' : 'IDLE';
          const desc = (e.des_job||'').split(',')[0].trim();
          const key  = desc ? `${cat}: ${desc}` : cat;
          reasonMap.set(key, (reasonMap.get(key) ?? 0) + e.dur_min);
        }
      }
      const topReasons = [...reasonMap.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([r, min]) => `"${r}" (${min >= 60 ? Math.floor(min/60)+'h '+(min%60)+'m' : min+'m'})`);
      pkgNote = ` Package ที่ได้รับผลกระทบสูงสุดคือ "${pkgName}" (${pkgData.mids.length} เครื่อง, สูญเสียรวม ${pkgTotalH}h) — สาเหตุหลักที่ทำให้ utilization ตก: ${topReasons.join(', ') || '—'}`;
    }

    return `Fleet WB กะนี้มี utilization เฉลี่ย ${kpi.avg_util}%${trendTxt}. ${belowNote}. ${failureSummary}${colletNote}${waitNote}${setupNote}${pkgNote}`.trim();
  });

  onMount(() => { loadPackages(); });
</script>

<svelte:head><title>WB Report — EMH Dashboard</title></svelte:head>

<!-- ── Header ────────────────────────────────────────────────────────────── -->
<div class="wb-header">
  <div>
    <h2>Wire Bond — Utilization &amp; Downtime Report</h2>
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
    <label class="flbl" for="wb-date">DATE</label>
    <input id="wb-date" type="date" class="input" style="width:150px" bind:value={selDate}
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
      <div class="fleet-cards">
      <div class="fleet-stat" style="--c:var(--color-primary)">
        <span class="fs-val">{kpi.total}</span>
        <div class="fs-row"><span class="fs-lbl">Machines</span></div>
      </div>
      <div class="fleet-stat" style="--c:#CC0000">
        <span class="fs-val">{kpi.n_down}</span>
        <div class="fs-row"><span class="fs-lbl">M/C Down</span>
          {#if kd?.n_down}<span class="fs-delta" class:up={kd.n_down.good} class:dn={!kd.n_down.good}>{kd.n_down.txt}</span>{/if}
        </div>
      </div>
      <div class="fleet-stat" style="--c:{utilColor(kpi.avg_util)}">
        <span class="fs-val">{kpi.avg_util}%</span>
        <div class="fs-row"><span class="fs-lbl">Avg Util</span>
          {#if kd?.avg_util}<span class="fs-delta" class:up={kd.avg_util.good} class:dn={!kd.avg_util.good}>{kd.avg_util.txt}%</span>{/if}
        </div>
      </div>
      <div class="fleet-stat" style="--c:#CC0000">
        <span class="fs-val">{kpi.n_low}</span>
        <div class="fs-row"><span class="fs-lbl">Util &lt;85%</span>
          {#if kd?.n_low}<span class="fs-delta" class:up={kd.n_low.good} class:dn={!kd.n_low.good}>{kd.n_low.txt}</span>{/if}
        </div>
      </div>
      <div class="fleet-stat" style="--c:#702076">
        <span class="fs-val">{kpi.n_tech}</span>
        <div class="fs-row"><span class="fs-lbl">Techs</span></div>
      </div>
      </div><!-- /fleet-cards -->
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
            {#if kd?.idle_pct}<span class="kc-vs" class:vs-good={kd.idle_pct.good} class:vs-bad={!kd.idle_pct.good}>{kd.idle_pct.txt}% vs avg</span>{/if}
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

  <!-- ── Hourly Event Heatmap ─────────────────────────────────────────────── -->
  {#if heatmap}
  <div class="hm-card">
    <div class="hm-card-hdr">
      <div class="hm-card-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        Event Pattern — Hourly
        <span class="hm-card-sub">Hover cell for details</span>
      </div>
      <div class="hm-toggle-group">
        <button class="hm-toggle-btn" class:hm-tog-active={hmMode==='ev'}  onclick={()=>hmMode='ev'}>Events</button>
        <button class="hm-toggle-btn" class:hm-tog-active={hmMode==='min'} onclick={()=>hmMode='min'}>Minutes</button>
      </div>
    </div>

    <div class="hm-grid" style="--hm-cols:{heatmap.shiftHours.length}">
      <div class="hm-label-cell hm-axis-corner"></div>
      {#each heatmap.shiftHours as h (h)}<div class="hm-col-hdr">{hmHour(h)}</div>{/each}
      <div class="hm-col-hdr hm-total-hdr">TOTAL</div>

      {#each heatmap.rows as row (row.key)}
        {@const rmax     = hmRowMax(row)}
        {@const stateMax = row.state.length ? Math.max(...row.state, 1) : 1}
        {@const hasState = row.state.length > 0}
        <div class="hm-row-label" style="--rc:rgb({row.baseRgb})">
          <span><span class="hm-row-dot"></span> {row.label}</span>
          <span class="hm-row-sublbl">events started</span>
          {#if row.key === 'down'  && lossStats.wait.mttwDown  > 0}<span class="hm-mttw" title="Mean Time To Wait">⏱ {fmtMtx(lossStats.wait.mttwDown)}</span>{/if}
          {#if row.key === 'setup' && lossStats.wait.mttwSetup > 0}<span class="hm-mttw" title="Mean Time To Wait">⏱ {fmtMtx(lossStats.wait.mttwSetup)}</span>{/if}
        </div>
        {#each row.hours as bucket, i (i)}
          {@const val = hmMode==='ev' ? bucket.ev : bucket.min}
          {@const bg  = hmCellBg(val, rmax, row.baseRgb)}
          {@const tc  = hmTextColor(val, rmax)}
          <div class="hm-cell" style:background={bg} style:color={tc}
               title="{hmHour(heatmap.shiftHours[i])} · {row.label}&#10;Events: {bucket.ev} · {bucket.min>=60?Math.floor(bucket.min/60)+'h '+(bucket.min%60)+'m':bucket.min+'m'}">
            <span class="hm-cell-val">{val > 0 ? (hmMode==='ev' ? val : hmFmt(bucket)) : ''}</span>
            {#if val > 0}<div class="hm-cell-bar" style:width="{Math.round(val/rmax*100)}%" style:background="rgb({row.baseRgb})"></div>{/if}
          </div>
        {/each}
        <div class="hm-total-cell" style="--rc:rgb({row.baseRgb})">{hmTotal(row)}</div>

        {#if hasState}
          <div class="hm-state-label" style="--rc:rgb({row.baseRgb})"><span class="hm-state-dot"></span><span>in state</span></div>
          {#each row.state as cnt, i (i)}
            {@const a  = Math.round((cnt/stateMax*0.75+0.1)*100)/100}
            {@const tc2 = a>0.45?'#fff':'#1a1a2e'}
            <div class="hm-state-cell" style:background="rgba({row.baseRgb},{a})" style:color={tc2}
                 title="{hmHour(heatmap.shiftHours[i])} · {row.label}&#10;{cnt} machines in state">
              {#if cnt > 0}<span class="hm-state-val">{cnt}</span>{/if}
            </div>
          {/each}
          <div class="hm-state-total" style="--rc:rgb({row.baseRgb})">peak {Math.max(...row.state)}</div>
        {/if}
      {/each}

      <!-- Total non-running -->
      <div class="hm-state-label hm-nonrun-label" style="--rc:#0F172A"><span class="hm-state-dot" style="background:#0F172A"></span><span>non-running</span></div>
      {#each heatmap.totalState as cnt, i (i)}
        {@const pct = cnt/(machines.length||1)*100}
        {@const a   = Math.round((pct/100*0.8+0.08)*100)/100}
        {@const tc3 = a>0.45?'#fff':'#1a1a2e'}
        <div class="hm-state-cell hm-nonrun-cell" style:background="rgba(15,23,42,{a})" style:color={tc3}
             title="{hmHour(heatmap.shiftHours[i])}&#10;{cnt}/{machines.length} ({pct.toFixed(0)}%) not running">
          {#if cnt > 0}<span class="hm-state-val">{cnt}</span>{/if}
        </div>
      {/each}
      <div class="hm-state-total" style="--rc:#0F172A;font-size:10px">peak {Math.max(...heatmap.totalState)}<br><span style="font-size:9px;opacity:.7">{Math.round(Math.max(...heatmap.totalState)/machines.length*100)}%</span></div>

      <!-- Event sum row -->
      <div class="hm-label-cell hm-sum-label">All events</div>
      {#each heatmap.shiftHours as h, i (h)}
        {@const colSum = heatmap.rows.reduce((s,r)=>s+(hmMode==='ev'?r.hours[i].ev:r.hours[i].min),0)}
        <div class="hm-sum-cell">{colSum > 0 ? (hmMode==='ev' ? colSum : colSum>=60?Math.floor(colSum/60)+'h '+(colSum%60)+'m':colSum+'m') : '—'}</div>
      {/each}
      <div class="hm-sum-cell hm-sum-grand">
        {heatmap.rows.reduce((s,r)=>s+(hmMode==='ev'?r.hours.reduce((a,b)=>a+b.ev,0):r.hours.reduce((a,b)=>a+b.min,0)),0)}{hmMode==='ev'?' ev':'m'}
      </div>
    </div>

    <div class="hm-peaks">
      {#each heatmap.rows as row (row.key)}
        {@const rmax = hmRowMax(row)}
        {@const peakIdx = row.hours.findIndex(h=>(hmMode==='ev'?h.ev:h.min)===rmax)}
        {#if rmax > 0 && peakIdx >= 0}
          <div class="hm-peak-badge" style="--rc:rgb({row.baseRgb})">
            <span class="hm-peak-dot"></span>
            {row.label} peak: {hmHour(heatmap.shiftHours[peakIdx])} &nbsp;({hmMode==='ev' ? rmax+' ev' : hmFmt(row.hours[peakIdx])})
          </div>
        {/if}
      {/each}
      {#if hmMode === 'ev'}
        {@const downOverlap  = lossStats.down.events  - heatmap.rows.find(r=>r.key==='down')!.hours.reduce((s,h)=>s+h.ev,0)}
        {@const setupOverlap = lossStats.setup.events - heatmap.rows.find(r=>r.key==='setup')!.hours.reduce((s,h)=>s+h.ev,0)}
        {#if downOverlap > 0 || setupOverlap > 0}
          <span class="hm-overlap-note">* รวม {downOverlap + setupOverlap} event ที่เริ่มก่อน shift window (carry-over จากกะก่อนหน้า)</span>
        {/if}
      {/if}
    </div>
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
        {id:'<85%', label:'Util < 85%',  count:chipCounts['<85%'],     alert:true},
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
      <span class="leg-item leg-warn" style="--lc:#CC0000">Util &lt; 85%</span>
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
  /* ── Header ──────────────────────────────────────────────────────────── */
  .wb-header {
    background: #0F172A;
    border-bottom: 3px solid #1D9CE4;
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
  .shift-btn.active      { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }

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
  .pkg-item.active { background: #EEF4FF; color: var(--color-primary); font-weight: 600; }
  .pkg-check { width: 14px; font-size: 11px; font-weight: 700; color: var(--color-primary); flex-shrink: 0; }
  .pkg-footer {
    display: flex; align-items: center; gap: 6px; padding: 6px 10px;
    border-top: 1px solid var(--color-border); background: var(--color-surface-alt);
  }
  .pkg-quick {
    font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px;
    border: 1px solid var(--color-border-strong); background: transparent;
    cursor: pointer; color: var(--color-primary); transition: all .1s;
  }
  .pkg-quick:hover { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
  .pkg-count { font-size: 11px; color: var(--color-text-disabled); margin-left: auto; }

  /* Buttons */
  .btn-load {
    background: var(--color-primary); color: #fff; border: none;
    border-radius: var(--r-sm); padding: 7px 20px; font-size: 13px;
    font-weight: 700; cursor: pointer; transition: opacity .12s; white-space: nowrap;
  }
  .btn-load:disabled { opacity: .45; cursor: not-allowed; }
  .btn-export {
    background: rgba(255,255,255,.15); color: #fff;
    border: 1px solid rgba(255,255,255,.4); border-radius: var(--r-sm);
    padding: 6px 14px; font-size: 12px; font-weight: 700;
    cursor: pointer; transition: background .12s;
  }
  .btn-export:hover  { background: rgba(255,255,255,.25); }
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

  /* 88px label column = wide enough for "SHIFT LOSS %" — both rows align */
  .fleet-row, .loss-row {
    display: grid; grid-template-columns: 88px 1fr;
    align-items: stretch; gap: 0 12px; position: relative;
    padding: 10px 20px;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }
  .loss-row { background: var(--color-surface-alt); }

  .kpi-block-label {
    font-size: 9px; font-weight: 800; letter-spacing: 1.2px;
    text-transform: uppercase; color: var(--color-text-disabled);
    display: flex; align-items: center;
  }

  .fleet-cards { display: flex; gap: 8px; align-items: stretch; }
  .fleet-stat {
    display: flex; flex-direction: column; justify-content: center; gap: 3px;
    background: var(--color-surface-alt);
    border-left: 3px solid var(--c);
    border-radius: var(--r-sm);
    padding: 10px 16px;
    flex: 1; min-width: 110px; min-height: 56px;
  }
  .fs-val  { font-size: 22px; font-weight: 800; color: var(--c); font-variant-numeric: tabular-nums; line-height: 1; }
  .fs-row  { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 18px; }
  .fs-lbl  { font-size: 10px; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .3px; }
  .fs-delta { font-size: 11px; font-weight: 700; padding: 1px 5px; border-radius: 3px; }
  .fs-delta.up { background: #E8F5E9; color: #2E7D32; }
  .fs-delta.dn { background: #FFEBEE; color: #C62828; }

  .kpi-row-cards { display: flex; gap: 6px; flex: 1; }

  /* Fleet cards — compact number + label */
  .kc {
    display: flex; flex-direction: column; align-items: flex-start;
    background: var(--color-surface); border-radius: var(--r-sm);
    border-left: 3px solid var(--c);
    padding: 8px 10px; flex: 1; min-width: 0;
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
  .tt-mc       { font-size: 12px; font-weight: 700; color: var(--color-primary); flex: 1; }
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
    border-radius: 12px; border: 1.5px solid var(--color-primary);
    background: transparent; color: var(--color-primary); cursor: pointer; transition: all .1s;
  }
  .chip-btn.active     { background: var(--color-primary); color: #fff; }
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
  .machine-table thead tr:last-child { background: var(--color-primary); }
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

  .mc-id  { font-weight: 700; color: var(--color-primary); font-size: 12px; }
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

  /* ── 7d delta styles ─────────────────────────────────────────────────── */
  .fs-delta { font-size: 11px; font-weight: 700; padding: 1px 5px; border-radius: 3px; }
  .fs-delta.up { background: #E8F5E9; color: #2E7D32; }
  .fs-delta.dn { background: #FFEBEE; color: #C62828; }
  .kpi7d-note { font-size: 9px; font-weight: 600; color: var(--color-text-disabled); white-space: nowrap; position: absolute; right: 20px; bottom: 8px; }
  .kc-vs { font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; display: inline-block; margin-bottom: 2px; }
  .kc-vs.vs-good { background: #E8F5E9; color: #2E7D32; }
  .kc-vs.vs-bad  { background: #FFEBEE; color: #C62828; }
  .kc-ev-delta { font-size: 10px; font-weight: 700; margin-left: 3px; }
  .kc-ev-delta.ev-good { color: #2E7D32; }
  .kc-ev-delta.ev-bad  { color: #C62828; }

  /* ── Narrative ───────────────────────────────────────────────────────── */
  .narrative-card { background:var(--color-surface);border:1px solid var(--color-border-strong);border-left:4px solid #4A90D9;border-radius:var(--r-sm);padding:14px 18px;margin-bottom:12px; }
  .narrative-hdr  { display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--color-text-heading);margin-bottom:8px; }
  .narrative-icon { font-size:16px; }
  .narrative-badge { font-size:10px;font-weight:700;background:#E3F0FB;color:#1A3A6C;border-radius:10px;padding:2px 8px;margin-left:4px; }
  .narrative-body { font-size:13px;line-height:1.7;color:var(--color-text-body,#334); }

  /* ── Heatmap ─────────────────────────────────────────────────────────── */
  .hm-card { background:var(--color-surface);border:1px solid var(--color-border-strong);border-radius:var(--r-sm);padding:16px 20px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.06); }
  .hm-card-hdr { display:flex;align-items:center;justify-content:space-between;margin-bottom:14px; }
  .hm-card-title { display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--color-text-heading); }
  .hm-card-sub   { font-size:11px;font-weight:400;color:var(--color-text-muted);margin-left:4px; }
  .hm-toggle-group { display:flex;border:1px solid var(--color-border-strong);border-radius:6px;overflow:hidden; }
  .hm-toggle-btn { padding:4px 12px;font-size:11px;font-weight:600;border:none;cursor:pointer;background:transparent;color:var(--color-text-muted);transition:all .15s; }
  .hm-toggle-btn.hm-tog-active { background:var(--color-primary);color:#fff; }
  .hm-grid { display:grid;grid-template-columns:100px repeat(var(--hm-cols),minmax(44px,72px)) 72px;gap:3px;align-items:stretch; }
  .hm-axis-corner { }
  .hm-col-hdr { font-size:9.5px;font-weight:700;color:var(--color-text-muted);text-align:center;padding:4px 2px;border-bottom:2px solid var(--color-border-strong);letter-spacing:.2px; }
  .hm-total-hdr { color:var(--color-text-heading);font-weight:800; }
  .hm-row-label { display:flex;flex-direction:column;align-items:flex-start;gap:2px;font-size:11px;font-weight:700;color:var(--color-text-heading);padding:4px 4px 4px 8px;border-left:3px solid var(--rc); }
  .hm-row-label > :first-child { display:flex;align-items:center;gap:5px; }
  .hm-row-dot    { width:8px;height:8px;border-radius:50%;background:var(--rc);flex-shrink:0; }
  .hm-row-sublbl { font-size:9px;font-weight:500;color:var(--color-text-disabled); }
  .hm-mttw { font-size:9px;font-weight:700;color:var(--rc);background:color-mix(in srgb,rgb(var(--rc-raw,128,128,128)) 10%,transparent);border:1px solid color-mix(in srgb,rgb(var(--rc-raw,128,128,128)) 20%,transparent);border-radius:3px;padding:1px 4px;white-space:nowrap;margin-top:2px; }
  .hm-cell { position:relative;border-radius:5px;min-height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;transition:transform .12s,box-shadow .12s;cursor:default;background:var(--color-surface-alt); }
  .hm-cell:hover { transform:scale(1.08);z-index:30;box-shadow:0 3px 14px rgba(0,0,0,.22); }
  .hm-cell-val { font-size:13px;font-weight:700;line-height:1;z-index:1; }
  .hm-cell-bar { position:absolute;bottom:0;left:0;height:3px;border-radius:0 0 5px 5px;opacity:.55; }
  .hm-total-cell { font-size:11px;font-weight:800;color:var(--rc);display:flex;align-items:center;justify-content:flex-end;padding-right:4px;border-left:1px solid var(--color-border-strong); }
  .hm-state-label { display:flex;align-items:center;gap:5px;padding:2px 4px 2px 12px;border-left:2px dashed var(--rc);font-size:9px;font-weight:700;color:var(--color-text-muted);opacity:.85; }
  .hm-state-dot { width:6px;height:6px;border-radius:50%;background:var(--rc);flex-shrink:0; }
  .hm-state-cell { border-radius:4px;min-height:32px;display:flex;align-items:center;justify-content:center;transition:transform .1s;cursor:default;border:1px dashed rgba(0,0,0,.08); }
  .hm-state-cell:hover { transform:scale(1.1);z-index:10;box-shadow:0 2px 8px rgba(0,0,0,.2); }
  .hm-state-val  { font-size:11px;font-weight:700; }
  .hm-state-total { font-size:10px;font-weight:800;color:var(--rc);display:flex;flex-direction:column;align-items:flex-end;justify-content:center;padding-right:4px;line-height:1.3;border-left:1px solid var(--color-border-strong); }
  .hm-nonrun-label { margin-top:4px;border-left-color:#0F172A;border-left-style:solid;border-left-width:3px; }
  .hm-nonrun-cell  { min-height:36px;border-style:solid;border-color:rgba(0,0,0,.06);border-radius:5px; }
  .hm-label-cell { display:flex;align-items:center; }
  .hm-sum-label  { font-size:10px;font-weight:700;color:var(--color-text-muted);padding:4px 6px;border-top:2px solid var(--color-border-strong); }
  .hm-sum-cell   { font-size:11px;font-weight:600;color:var(--color-text-muted);text-align:center;padding:5px 2px;border-top:2px solid var(--color-border-strong); }
  .hm-sum-grand  { font-weight:800;color:var(--color-text-heading); }
  .hm-peaks { display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--color-border-strong); }
  .hm-peak-badge { display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:var(--color-text-body);background:var(--color-surface-alt);border:1px solid var(--color-border-strong);border-left:3px solid var(--rc);border-radius:5px;padding:4px 10px; }
  .hm-peak-dot   { width:7px;height:7px;border-radius:50%;background:var(--rc); }
  .hm-overlap-note { font-size:10px;color:var(--color-text-disabled);align-self:center;margin-left:auto; }
</style>
