<script lang="ts">
  import { page } from '$app/state'
  import { base } from '$app/paths'
  import '../app.css'
  import Sidebar from '$lib/components/Sidebar.svelte'
  import { sidebar, themeStore } from '$lib/stores/ui.svelte'
  import { onMount } from 'svelte'
  import type { LayoutData } from './$types'

  let { children, data }: { children: any; data: LayoutData } = $props()

  onMount(() => themeStore.apply())

  const isLogin = $derived(
    page.url.pathname === `${base}/login` ||
    page.url.pathname === `${base}/login/` ||
    page.url.pathname === '/login'
  )

  const roleLabel: Record<string, string> = {
    admin: 'Admin',
    supervisor: 'Supervisor',
    viewer: 'Viewer',
  }
  const roleColor: Record<string, string> = {
    admin: 'var(--color-brand-red)',
    supervisor: '#1D9CE4',
    viewer: 'var(--color-text-muted)',
  }
</script>

{#if isLogin}
  {@render children()}
{:else}
  <div class="app-shell" class:collapsed={sidebar.collapsed}>
    <Sidebar />
    <div class="main-wrap">
      <header class="topbar">
        <div class="tb-left">
          <!-- breadcrumb could go here -->
        </div>
        <div class="tb-right">
          {#if data.user}
            <div class="user-info">
              <span class="user-name">{data.user.displayName}</span>
              <span class="role-badge" style="color:{roleColor[data.user.role] ?? 'inherit'}">
                {roleLabel[data.user.role] ?? data.user.role}
              </span>
            </div>
          {/if}
          <button class="tb-btn" onclick={() => themeStore.toggle()} title="Toggle dark mode">
            {themeStore.current === 'light' ? '🌙' : '☀️'}
          </button>
          {#if data.user?.role === 'admin'}
            <a href="{base}/admin" class="tb-btn" title="Admin">⚙️</a>
          {/if}
          <form method="POST" action="{base}/logout" style="display:contents">
            <button type="submit" class="tb-btn" title="Logout">🚪</button>
          </form>
        </div>
      </header>
      <main class="main-content">
        {@render children()}
      </main>
    </div>
  </div>
{/if}

<style>
  .app-shell {
    display: flex;
    min-height: 100vh;
  }

  .main-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .topbar {
    height: var(--topbar-h);
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border-strong);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--gutter);
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .tb-right { display: flex; align-items: center; gap: 4px; }

  .user-info {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    margin-right: 8px;
    line-height: 1.2;
  }

  .user-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
  }

  .role-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .tb-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 18px;
    width: 36px;
    height: 36px;
    border-radius: var(--r-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
    transition: background 0.12s;
    text-decoration: none;
  }

  .tb-btn:hover { background: var(--color-surface-gray); }

  .main-content {
    flex: 1;
    padding: var(--gutter);
    overflow-y: auto;
  }
</style>
