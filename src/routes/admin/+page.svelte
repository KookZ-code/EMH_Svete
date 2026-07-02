<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte'
  import DataTable from '$lib/components/DataTable.svelte'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  // ─── Types ───────────────────────────────────────────────────────────────
  interface UserRow {
    id: number
    username: string
    display_name: string
    role: 'admin' | 'supervisor' | 'viewer'
    created_at: string
  }

  // ─── Known app routes (for permissions UI) ───────────────────────────────
  const APP_ROUTES = [
    { path: '/',               label: 'Overview' },
    { path: '/live',           label: 'Live Board' },
    { path: '/utilization',    label: 'Utilization' },
    { path: '/downtime',       label: 'Downtime' },
    { path: '/machine-detail', label: 'Machine Detail' },
    { path: '/timeline',       label: 'Tech Performance' },
    { path: '/inventory',      label: 'Inventory' },
    { path: '/wb-report',      label: 'WB Report' },
    { path: '/da-report',      label: 'DA Report' },
    { path: '/store-items',    label: 'Store Items' },
  ]

  // ─── State ───────────────────────────────────────────────────────────────
  type TabId = 'users' | 'permissions'
  let activeTab = $state<TabId>('users')

  let users = $state<UserRow[]>([...( data.users ?? [])])

  // Permissions: { supervisor: Set<string>, viewer: Set<string> }
  let supervisorPerms = $state<Set<string>>(new Set<string>(data.permissions?.supervisor ?? []))
  let viewerPerms     = $state<Set<string>>(new Set<string>(data.permissions?.viewer ?? []))

  let showForm   = $state(false)
  let showPwForm = $state(false)
  let editUser   = $state<UserRow | null>(null)
  let pwUserId   = $state<number | null>(null)
  let pwUsername = $state('')
  let formUser   = $state({ username: '', display_name: '', role: 'viewer' as UserRow['role'], password: '' })
  let formError  = $state('')
  let permsSaving = $state<string | null>(null)
  let permsMsg    = $state('')

  const roleColors: Record<string, string> = {
    admin: '#CC0000',
    supervisor: '#1D9CE4',
    viewer: '#8A8A8A',
  }

  // ─── User helpers ─────────────────────────────────────────────────────────
  function openNew() {
    editUser = null
    formUser = { username: '', display_name: '', role: 'viewer', password: '' }
    formError = ''
    showForm = true
  }

  function openEdit(u: UserRow) {
    editUser = u
    formUser = { username: u.username, display_name: u.display_name, role: u.role, password: '' }
    formError = ''
    showForm = true
  }

  function openPw(u: UserRow) {
    pwUserId = u.id
    pwUsername = u.username
    formUser = { ...formUser, password: '' }
    formError = ''
    showPwForm = true
  }

  async function saveUser() {
    formError = ''
    if (!formUser.username.trim()) { formError = 'Username required'; return }
    if (!editUser && formUser.password.length < 6) { formError = 'Password min 6 characters'; return }

    const method = editUser ? 'PUT' : 'POST'
    const url    = editUser ? `/api/v1/users/${editUser.id}` : '/api/v1/users'
    const body   = editUser
      ? { display_name: formUser.display_name, role: formUser.role }
      : { username: formUser.username, display_name: formUser.display_name, role: formUser.role, password: formUser.password }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok || json.error) { formError = json.error?.message ?? 'Save failed'; return }

    // Reload users
    const listRes = await fetch('/api/v1/users')
    if (listRes.ok) users = (await listRes.json()).data ?? users
    showForm = false
  }

  async function savePassword() {
    formError = ''
    if (formUser.password.length < 6) { formError = 'Password min 6 characters'; return }
    const res = await fetch(`/api/v1/users/${pwUserId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: formUser.password }),
    })
    const json = await res.json()
    if (!res.ok || json.error) { formError = json.error?.message ?? 'Save failed'; return }
    showPwForm = false
  }

  async function deleteUser(u: UserRow) {
    if (!confirm(`Delete user "${u.username}"?`)) return
    await fetch(`/api/v1/users/${u.id}`, { method: 'DELETE' })
    users = users.filter(x => x.id !== u.id)
  }

  // ─── Permissions helpers ──────────────────────────────────────────────────
  function togglePerm(role: 'supervisor' | 'viewer', path: string) {
    if (role === 'supervisor') {
      const s = new Set(supervisorPerms)
      s.has(path) ? s.delete(path) : s.add(path)
      supervisorPerms = s
    } else {
      const s = new Set(viewerPerms)
      s.has(path) ? s.delete(path) : s.add(path)
      viewerPerms = s
    }
  }

  async function savePerms(role: 'supervisor' | 'viewer') {
    permsSaving = role
    permsMsg = ''
    const paths = role === 'supervisor' ? [...supervisorPerms] : [...viewerPerms]
    const res = await fetch(`/api/v1/permissions/${role}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    })
    permsSaving = null
    permsMsg = res.ok ? `${role} permissions saved` : 'Save failed'
    setTimeout(() => (permsMsg = ''), 3000)
  }

  // ─── Table columns ────────────────────────────────────────────────────────
  const cols = [
    { key: 'username',     label: 'Username',     sortable: true },
    { key: 'display_name', label: 'Display Name', sortable: true },
    {
      key: 'role', label: 'Role', width: '110px',
      renderHtml: (v: unknown) => {
        const r = String(v)
        return `<span style="background:${roleColors[r] ?? '#8A8A8A'};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px">${r.toUpperCase()}</span>`
      },
    },
    { key: 'created_at', label: 'Created', width: '130px',
      format: (v: unknown) => {
        try { return new Date(String(v)).toLocaleDateString('th-TH', { year:'2-digit', month:'short', day:'2-digit' }) }
        catch { return String(v) }
      },
    },
  ]
</script>

<svelte:head><title>Admin — EMH Dashboard</title></svelte:head>

<PageHeader title="Admin Panel" subtitle="User management & permissions" />

<!-- Tabs -->
<div class="tabs">
  <button class="tab" class:active={activeTab === 'users'}       onclick={() => (activeTab = 'users')}>👥 Users</button>
  <button class="tab" class:active={activeTab === 'permissions'} onclick={() => (activeTab = 'permissions')}>🔐 Permissions</button>
</div>

<!-- ── Users Tab ── -->
{#if activeTab === 'users'}
  <div class="chart-card">
    <div class="adm-toolbar">
      <div class="card-title">Users ({users.length})</div>
      <button class="btn btn-solid btn-sm" onclick={openNew}>+ Add User</button>
    </div>

    <DataTable columns={cols} rows={users} rowKey={r => String(r.id)} compact />

    <!-- Per-row action buttons -->
    <div class="user-actions-list">
      {#each users as u}
        <div class="ua-row">
          <span class="ua-name">{u.username}</span>
          <div class="ua-btns">
            <button class="btn-xs" onclick={() => openEdit(u)}>Edit</button>
            <button class="btn-xs" onclick={() => openPw(u)}>Reset PW</button>
            {#if u.role !== 'admin'}
              <button class="btn-xs danger" onclick={() => deleteUser(u)}>Delete</button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<!-- ── Permissions Tab ── -->
{#if activeTab === 'permissions'}
  <div class="perm-grid">
    {#each [{ role: 'supervisor', label: 'Supervisor', perms: supervisorPerms }, { role: 'viewer', label: 'Viewer', perms: viewerPerms }] as col (col.role)}
      <div class="chart-card">
        <div class="adm-toolbar">
          <div class="card-title" style="color:{roleColors[col.role]}">{col.label}</div>
          <button
            class="btn btn-solid btn-sm"
            onclick={() => savePerms(col.role as 'supervisor' | 'viewer')}
            disabled={permsSaving === col.role}
          >
            {permsSaving === col.role ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div class="route-list">
          {#each APP_ROUTES as r}
            <label class="route-row">
              <input
                type="checkbox"
                checked={col.perms.has(r.path)}
                onchange={() => togglePerm(col.role as 'supervisor' | 'viewer', r.path)}
              />
              <span class="route-path">{r.path}</span>
              <span class="route-label">{r.label}</span>
            </label>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Admin note -->
  <div class="admin-note">
    ⚠️ Admin เข้าได้ทุกหน้าเสมอ — ไม่สามารถเปลี่ยนสิทธิ์ Admin ได้
  </div>

  {#if permsMsg}
    <div class="perms-toast">{permsMsg}</div>
  {/if}
{/if}

<!-- ── User Form Modal ── -->
{#if showForm}
  <div class="modal-overlay" onclick={() => (showForm = false)} role="dialog" aria-modal="true" tabindex="-1" onkeydown={() => {}}>
    <div class="modal-card" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="presentation">
      <h3 class="modal-title">{editUser ? 'Edit User' : 'New User'}</h3>

      {#if formError}
        <div class="form-error">{formError}</div>
      {/if}

      <div class="form-grid">
        <div class="fg">
          <label class="label" for="fu-username">Username</label>
          <input id="fu-username" class="input" type="text" bind:value={formUser.username} disabled={!!editUser} />
        </div>
        <div class="fg">
          <label class="label" for="fu-display">Display Name</label>
          <input id="fu-display" class="input" type="text" bind:value={formUser.display_name} />
        </div>
        <div class="fg">
          <label class="label" for="fu-role">Role</label>
          <select id="fu-role" class="input" bind:value={formUser.role}>
            <option value="viewer">Viewer</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {#if !editUser}
          <div class="fg">
            <label class="label" for="fu-pw">Password</label>
            <input id="fu-pw" class="input" type="password" bind:value={formUser.password} placeholder="min 6 chars" />
          </div>
        {/if}
      </div>

      <div class="modal-actions">
        <button class="btn btn-outline" onclick={() => (showForm = false)}>Cancel</button>
        <button class="btn btn-solid" onclick={saveUser}>Save</button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Password Reset Modal ── -->
{#if showPwForm}
  <div class="modal-overlay" onclick={() => (showPwForm = false)} role="dialog" aria-modal="true" tabindex="-1" onkeydown={() => {}}>
    <div class="modal-card" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="presentation">
      <h3 class="modal-title">Reset Password — {pwUsername}</h3>

      {#if formError}
        <div class="form-error">{formError}</div>
      {/if}

      <div class="fg" style="margin-bottom:16px">
        <label class="label" for="pw-new">New Password</label>
        <input id="pw-new" class="input" type="password" bind:value={formUser.password} placeholder="min 6 chars" />
      </div>

      <div class="modal-actions">
        <button class="btn btn-outline" onclick={() => (showPwForm = false)}>Cancel</button>
        <button class="btn btn-solid" onclick={savePassword}>Save Password</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .tabs { display: flex; gap: 4px; margin-bottom: 16px; }

  .tab {
    padding: 8px 20px;
    font-size: 13px; font-weight: 600;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm);
    background: var(--color-surface);
    cursor: pointer;
    color: var(--color-text-muted);
    transition: all 0.12s;
  }
  .tab.active {
    background: var(--color-primary);
    color: #fff;
    border-color: var(--color-primary);
  }

  .adm-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .card-title  { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); }

  /* User row actions */
  .user-actions-list { margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
  .ua-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; border-top: 1px solid var(--color-border); }
  .ua-name { font-size: 13px; color: var(--color-text-muted); }
  .ua-btns { display: flex; gap: 6px; }

  .btn-xs {
    padding: 3px 10px;
    font-size: 11px; font-weight: 600;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--r-sm);
    background: var(--color-surface);
    cursor: pointer;
    color: var(--color-text);
  }
  .btn-xs:hover { background: var(--color-surface-gray); }
  .btn-xs.danger { border-color: var(--color-brand-red); color: var(--color-brand-red); }
  .btn-xs.danger:hover { background: #FEE2E2; }

  /* Permissions grid */
  .perm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .route-list { display: flex; flex-direction: column; gap: 2px; }

  .route-row {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 8px;
    border-radius: var(--r-sm);
    cursor: pointer;
    font-size: 13px;
    transition: background 0.1s;
  }
  .route-row:hover { background: var(--color-surface-gray); }

  .route-path { font-family: monospace; font-size: 12px; color: var(--color-primary); min-width: 140px; }
  .route-label { color: var(--color-text-muted); }

  .admin-note {
    margin-top: 12px;
    font-size: 12px;
    color: var(--color-text-muted);
    background: var(--color-surface-gray);
    padding: 8px 12px;
    border-radius: var(--r-sm);
  }

  .perms-toast {
    position: fixed; bottom: 24px; right: 24px;
    background: var(--color-primary); color: #fff;
    padding: 10px 18px; border-radius: var(--r-sm);
    font-size: 13px; font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 2000;
  }

  /* Modal */
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; padding: 24px;
  }
  .modal-card {
    background: var(--color-surface);
    border-radius: var(--r-md);
    padding: 28px;
    width: 100%; max-width: 460px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  }
  .modal-title { font-size: 18px; font-weight: 700; color: var(--color-primary); margin-bottom: 16px; }
  .form-error {
    background: #FEE2E2; border: 1px solid var(--color-brand-red);
    color: var(--color-brand-red); font-size: 13px;
    padding: 8px 12px; border-radius: var(--r-sm); margin-bottom: 12px;
  }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .fg { display: flex; flex-direction: column; gap: 5px; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
</style>
