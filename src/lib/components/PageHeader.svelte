<script lang="ts">
  interface Props {
    title: string;
    subtitle?: string;
    badge?: string;         // e.g. "Live" or "Auto-refresh 5 min"
    badgeColor?: string;    // e.g. "#5EBF33"
    refreshAt?: string;     // ISO timestamp of last refresh
  }

  let { title, subtitle, badge, badgeColor = '#5EBF33', refreshAt }: Props = $props();

  function fmtTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }
</script>

<header class="page-header">
  <div class="ph-main">
    <h1 class="ph-title">{title}</h1>
    {#if subtitle}
      <p class="ph-subtitle">{subtitle}</p>
    {/if}
  </div>
  <div class="ph-right">
    {#if badge}
      <span class="ph-badge" style:background-color={badgeColor}>{badge}</span>
    {/if}
    {#if refreshAt}
      <span class="ph-refresh">Updated {fmtTime(refreshAt)}</span>
    {/if}
  </div>
</header>

<style>
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background-color: var(--color-primary);
    color: #fff;
    padding: 12px var(--gutter);
    border-left: 4px solid #FFD53A;
    border-radius: var(--r-sm);
    margin-bottom: var(--gutter);
    gap: 16px;
    flex-wrap: wrap;
  }

  .ph-main { display: flex; flex-direction: column; gap: 2px; }

  .ph-title {
    font-size: 18px;
    font-weight: 700;
    color: #fff;
    line-height: 1.2;
  }

  .ph-subtitle {
    font-size: 13px;
    color: rgba(255,255,255,0.7);
    margin: 0;
  }

  .ph-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .ph-badge {
    display: inline-block;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: var(--r-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .ph-refresh {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    white-space: nowrap;
  }
</style>
