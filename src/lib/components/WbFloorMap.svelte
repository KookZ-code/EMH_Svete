<script lang="ts">
  // WB Interactive Floor Map — renders the physical Wire Bond floor layout from
  // the static config generated out of "Lay out wire bond 1.xlsx" (WB_FLOOR), and
  // colors each machine cell by its live status (same statusConfig as the Live Board).
  //
  // Layout: each visual row is a 4-column CSS grid
  //   [left machines] [left LINE label] [right machines] [right LINE label]
  // so the LINE labels line up in fixed vertical columns regardless of how many
  // machines a line has. One Excel cell (a base number) expands to every physical
  // machine present — plain + L + R — each rendered as its own block.
  import { WB_FLOOR, type WbZone, type WbRow, type WbCell } from '$lib/config/wb_layout';
  import { statusStyle, fmtElapsed } from '$lib/config/machine_status';
  import type { LiveMachine } from '$types';

  interface Props {
    machines: LiveMachine[];
    onMachineClick: (code: string) => void;
  }
  let { machines, onMachineClick }: Props = $props();

  const byId = $derived(new Map(machines.map((m) => [m.code_machine, m])));

  // base number → physical machines to show.
  // If L/R variants exist, show only those (the plain id is the same physical unit).
  // If no L/R, show the plain machine only.
  function expandVariants(num: number): LiveMachine[] {
    const pad = String(num).padStart(3, '0');
    const L = byId.get(`W/B # ${pad}L`);
    const R = byId.get(`W/B # ${pad}R`);
    if (L || R) return [L, R].filter((m): m is LiveMachine => m != null);
    const plain = byId.get(`W/B # ${pad}`);
    return plain ? [plain] : [];
  }

  function variantLabel(num: number, code: string): string {
    const m = code.match(/([LR])$/);
    return String(num) + (m ? m[1] : '');
  }

  function tooltipOf(mc: LiveMachine): string {
    const cfg = statusStyle(mc.status);
    let t = `${mc.code_machine}${mc.model ? ' (' + mc.model + ')' : ''} — ${cfg.label}`;
    if (mc.symptom) t += `: ${mc.symptom}`;
    if (mc.status !== 'Running') {
      t += ` | ${fmtElapsed(mc.elapsed_min)}`;
      if (mc.tech_name) t += ` | ${mc.tech_name}`;
    }
    if (mc.package_type) t += `\n${mc.package_type}`;
    return t;
  }

  // Split a row's ordered cells into left/right zones around the LINE label(s).
  // Rows in Zone 1/2 have two LINE labels (left + right); Zone 3 has one (right only).
  interface SplitRow { left: WbCell[]; leftLabel: WbCell | null; right: WbCell[]; rightLabel: WbCell | null; }
  function splitRow(row: WbRow): SplitRow {
    const lineIdx = row.cells.map((c, i) => (c.kind === 'line' ? i : -1)).filter((i) => i >= 0);
    if (lineIdx.length >= 2) {
      const [a, b] = [lineIdx[0], lineIdx[lineIdx.length - 1]];
      return {
        left: row.cells.slice(0, a),
        leftLabel: row.cells[a],
        right: row.cells.slice(a + 1, b),
        rightLabel: row.cells[b],
      };
    }
    // single label (Zone 3): machines → right column, support → left column
    const idx = lineIdx[0] ?? row.cells.length;
    const before = row.cells.slice(0, idx);
    return {
      left: before.filter((c) => c.kind === 'support'),
      leftLabel: null,
      right: before.filter((c) => c.kind !== 'support'),
      rightLabel: row.cells[idx] ?? null,
    };
  }
</script>

<section class="floor">
  <h2 class="floor-title">WB Floor Map</h2>
  <p class="floor-sub">ผังพื้นจริงตาม "Lay out wire bond 1.xlsx" · คลิกเครื่องเพื่อ highlight ใน grid ด้านบน</p>

  {#each WB_FLOOR as zone (zone.id)}
    <div class="zone" class:z1={zone.id === 'Z1'} class:z3={zone.id === 'Z3'}>
      <div class="zhdr">{zone.label} &nbsp; (Supv. {zone.supervisor})</div>

      {#each zone.rows as row (row)}
        {@const sp = splitRow(row)}
        <div class="grow">
          <div class="zmc left">
            {@render cells(sp.left)}
          </div>
          <div class="lcol">
            {#if sp.leftLabel}<div class="lline">{sp.leftLabel.v}</div>{/if}
          </div>
          <div class="zmc right">
            {@render cells(sp.right)}
          </div>
          <div class="lcol">
            {#if sp.rightLabel}<div class="lline">{sp.rightLabel.v}</div>{/if}
          </div>
        </div>
      {/each}
    </div>
  {/each}
</section>

{#snippet cells(list: WbCell[])}
  {#each list as cell}
    {#if cell.kind === 'support'}
      <div class="sup" class:wide={cell.v.length > 6} style:background={cell.color}>{cell.v}</div>
    {:else if cell.kind === 'machine'}
      {@const variants = expandVariants(cell.num!)}
      {#if variants.length === 0}
        <div class="mc off" title="W/B #{cell.num} — no live data">{cell.num}</div>
      {:else}
        {#each variants as mc (mc.code_machine)}
          {@const cfg = statusStyle(mc.status)}
          <button
            class="mc"
            style:background={cfg.bg}
            style:color={cfg.text}
            title={tooltipOf(mc)}
            onclick={() => onMachineClick(mc.code_machine)}
          >
            {variantLabel(cell.num!, mc.code_machine)}{#if mc.is_key}<span class="k">K</span>{/if}
          </button>
        {/each}
      {/if}
    {/if}
  {/each}
{/snippet}

<style>
  .floor { margin-top: 16px; }
  .floor-title { font-size: 18px; font-weight: 700; color: var(--color-text-heading); margin-bottom: 2px; }
  .floor-sub { font-size: 12px; color: var(--color-text-muted); margin-bottom: 10px; }

  .zone {
    background: var(--color-surface); border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm); padding: 8px 10px; margin-bottom: 8px;
  }
  .zhdr {
    font-size: 11px; font-weight: 700; color: #B23A00; text-align: right;
    padding-bottom: 6px; border-bottom: 2px solid #E8A040; margin-bottom: 6px;
  }
  .zone.z1 .zhdr { color: var(--color-text-heading); border-color: #4A90D9; }
  .zone.z3 .zhdr { color: #1A6E2E; border-color: #5EBF33; }

  /* labels in fixed columns (col 2 + col 4) => LINE labels align vertically */
  .grow {
    display: grid; grid-template-columns: minmax(0,1fr) 58px minmax(0,1fr) 58px;
    gap: 6px; margin-bottom: 3px; align-items: start;
  }
  .zmc { display: flex; flex-wrap: wrap; gap: 2px; align-content: flex-start; }
  .lcol { display: flex; align-items: flex-start; }

  .mc {
    min-width: 26px; height: 18px; border-radius: 2px; font-size: 9px; font-weight: 600;
    display: flex; align-items: center; justify-content: center; gap: 1px;
    border: 1px solid rgba(0,0,0,0.12); padding: 0 2px; cursor: pointer;
    transition: transform 0.1s; font-family: inherit;
  }
  .mc:hover { transform: scale(1.8); z-index: 30; position: relative; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
  .mc.off { background: #EEF0F2; color: #B0B8C0; border-style: dashed; cursor: default; }
  .mc .k { font-size: 7px; font-weight: 700; background: rgba(255,255,255,0.35); border-radius: 2px; padding: 0 2px; }

  .lline {
    width: 56px; height: 18px; background: #66E0E0; border: 1px solid #3AA;
    border-radius: 2px; font-size: 9px; font-weight: 700; color: #0A4A4A;
    display: flex; align-items: center; justify-content: center;
  }

  .sup {
    min-width: 30px; height: 18px; border-radius: 2px; font-size: 8px; font-weight: 700; color: #333;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    border: 1px solid rgba(0,0,0,0.15); padding: 0 4px; white-space: nowrap;
  }
  .sup.wide { min-width: 64px; }
</style>
