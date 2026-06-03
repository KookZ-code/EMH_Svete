<script lang="ts">
  interface Props {
    label: string;
    value: string | number;
    accent?: string;     // CSS color for top bar
    icon?: string;       // emoji icon
    sub?: string;        // sub-label below value
    trend?: number;      // positive = up, negative = down
    href?: string;       // optional link
  }

  let { label, value, accent = 'var(--color-primary)', icon, sub, trend, href }: Props = $props();

  const tag = href ? 'a' : 'div';

  function trendColor(t: number): string {
    return t > 0 ? 'var(--status-running)' : t < 0 ? 'var(--status-down)' : 'var(--color-text-muted)';
  }
</script>

<svelte:element this={tag} {href} class="kpi-card" class:linked={!!href}>
  <span class="kpi-accent" style:background-color={accent}></span>
  <div class="kpi-body">
    {#if icon}
      <span class="kpi-icon" style:background-color="{accent}22">{icon}</span>
    {/if}
    <div class="kpi-text">
      <span class="kpi-value">{value}</span>
      {#if sub}
        <span class="kpi-sub">{sub}</span>
      {/if}
    </div>
  </div>
  <div class="kpi-footer">
    <span class="kpi-label">{label}</span>
    {#if trend !== undefined}
      <span class="kpi-trend" style:color={trendColor(trend)}>
        {trend > 0 ? '▲' : trend < 0 ? '▼' : '—'} {Math.abs(trend)}%
      </span>
    {/if}
  </div>
</svelte:element>

<style>
  .kpi-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm);
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: inherit;
    transition: box-shadow 0.15s;
  }

  .kpi-card.linked:hover {
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }

  .kpi-accent {
    display: block;
    height: 5px;
    width: 100%;
  }

  .kpi-body {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px 6px;
  }

  .kpi-icon {
    width: 38px;
    height: 38px;
    border-radius: var(--r-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
  }

  .kpi-text { display: flex; flex-direction: column; gap: 2px; }

  .kpi-value {
    font-size: 32px;
    font-weight: 700;
    line-height: 1;
    color: var(--color-text-heading);
  }

  .kpi-sub {
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .kpi-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px 12px;
    gap: 4px;
  }

  .kpi-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  .kpi-trend {
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
</style>
