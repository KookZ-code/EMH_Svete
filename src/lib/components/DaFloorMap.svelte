<script lang="ts">
  import { DA_FLOOR, type DaZone, type DaRow, type DaCell } from '$lib/config/da_layout';
  import { statusStyle, fmtElapsed } from '$lib/config/machine_status';
  import type { LiveMachine } from '$types';

  interface Props {
    machines: LiveMachine[];
    onMachineClick: (code: string) => void;
  }
  let { machines, onMachineClick }: Props = $props();

  const byId = $derived(new Map(machines.map((m) => [m.code_machine, m])));

  // DA machines have no L/R variants — just look up the plain ID directly
  function lookupMachine(id: string): LiveMachine | null {
    return byId.get(id) ?? null;
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
</script>

<section class="floor">
  <h2 class="floor-title">DA Floor Map</h2>
  <p class="floor-sub">ผังพื้นจริงตาม "Lay Out DA new version.xlsx" · คลิกเครื่องเพื่อ highlight ใน grid ด้านบน</p>

  {#each DA_FLOOR as zone (zone.id)}
    <div class="zone" class:z2={zone.id === 'Z2'}>
      <div class="zhdr">{zone.label}{zone.supervisor ? ' · ' + zone.supervisor : ''}</div>

      {#each zone.rows as row (row)}
        <!-- grid=true rows use explicit col placement for vertical alignment -->
        <div class="frow" class:grid-row={row.grid}>
          {#each row.cells as cell}
            {#if cell.kind === 'line'}
              <div class="lline" class:blank={!cell.v} style:grid-column={row.grid ? cell.col : null}>{cell.v}</div>
            {:else if cell.kind === 'support'}
              <div
                class="sup"
                class:wide={!row.grid && cell.v.length > 8}
                style:background={cell.color}
                style:grid-column={row.grid ? cell.col : null}
              >{cell.v}</div>
            {:else}
              {@const mc = lookupMachine(cell.v)}
              {#if mc}
                {@const cfg = statusStyle(mc.status)}
                <button
                  class="mc"
                  style:background={cfg.bg}
                  style:color={cfg.text}
                  style:grid-column={row.grid ? cell.col : null}
                  title={tooltipOf(mc)}
                  onclick={() => onMachineClick(mc.code_machine)}
                >
                  {cell.v.replace('D/B # ', '').replace(/^0+/, '') || '0'}
                  {#if mc.is_key}<span class="k">K</span>{/if}
                </button>
              {:else}
                <div
                  class="mc off"
                  style:grid-column={row.grid ? cell.col : null}
                  title="{cell.v} — no live data"
                >
                  {cell.v.replace('D/B # ', '').replace(/^0+/, '') || '0'}
                </div>
              {/if}
            {/if}
          {/each}
        </div>
      {/each}
    </div>
  {/each}
</section>

<style>
  .floor { margin-top: 16px; }
  .floor-title { font-size: 18px; font-weight: 700; color: var(--color-text-heading); margin-bottom: 2px; }
  .floor-sub { font-size: 12px; color: var(--color-text-muted); margin-bottom: 10px; }

  .zone {
    background: var(--color-surface); border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm); padding: 8px 10px; margin-bottom: 8px;
  }
  .zhdr {
    font-size: 11px; font-weight: 700; color: var(--color-text-heading);
    padding-bottom: 6px; border-bottom: 2px solid #4A90D9; margin-bottom: 6px;
    text-align: right;
  }
  .zone.z2 .zhdr { border-color: #E8A040; color: #B23A00; }

  .frow { display: flex; gap: 3px; margin-bottom: 3px; align-items: center; flex-wrap: wrap; }
  /* Zone 2 grid rows: 12 fixed columns matching Excel column positions */
  .frow.grid-row {
    display: grid;
    grid-template-columns: 56px repeat(11, 30px);
    gap: 3px;
    align-items: center;
  }
  /* Clip support text in grid rows — prevent overflow into adjacent cells */
  .frow.grid-row .sup {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 7.5px;
  }

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
    min-width: 56px; height: 18px; background: #66E0E0; border: 1px solid #3AA;
    border-radius: 2px; font-size: 9px; font-weight: 700; color: #0A4A4A;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  /* Empty placeholder — same size as LINE label but invisible */
  .lline.blank { background: transparent; border-color: transparent; }

  .sup {
    min-width: 30px; height: 18px; border-radius: 2px; font-size: 8px; font-weight: 700; color: #333;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    border: 1px solid rgba(0,0,0,0.15); padding: 0 4px; white-space: nowrap;
  }
  .sup.wide { min-width: 80px; }
</style>
