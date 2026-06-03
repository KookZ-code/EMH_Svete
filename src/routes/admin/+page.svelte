<script lang="ts">
  // Admin — User Management
  import PageHeader from '$lib/components/PageHeader.svelte';
  import DataTable from '$lib/components/DataTable.svelte';

  interface UserRow {
    id: string;
    username: string;
    display_name: string;
    role: 'admin' | 'supervisor' | 'viewer';
    last_login: string | null;
    active: boolean;
  }

  let users = $state<UserRow[]>([
    { id:'1', username:'admin',      display_name:'System Admin',     role:'admin',      last_login:'2026-06-02T08:00:00', active:true  },
    { id:'2', username:'supervisor1',display_name:'นาย ก. (Sup A)',   role:'supervisor', last_login:'2026-06-02T07:30:00', active:true  },
    { id:'3', username:'supervisor2',display_name:'นาย ข. (Sup B)',   role:'supervisor', last_login:'2026-06-01T15:20:00', active:true  },
    { id:'4', username:'viewer1',    display_name:'ผู้ชม 1',           role:'viewer',     last_login:'2026-06-01T10:00:00', active:true  },
    { id:'5', username:'viewer2',    display_name:'ผู้ชม 2',           role:'viewer',     last_login:null,                  active:false },
  ]);

  let showForm   = $state(false);
  let editUser   = $state<UserRow | null>(null);
  let formUser   = $state({ username:'', display_name:'', role:'viewer' as UserRow['role'], active:true });
  let formError  = $state('');

  const roleColors: Record<string,string> = { admin:'#CC0000', supervisor:'#1D9CE4', viewer:'#8A8A8A' };

  function openNew() {
    editUser = null;
    formUser = { username:'', display_name:'', role:'viewer', active:true };
    formError = '';
    showForm = true;
  }

  function openEdit(u: UserRow) {
    editUser = u;
    formUser = { username:u.username, display_name:u.display_name, role:u.role, active:u.active };
    formError = '';
    showForm = true;
  }

  function saveUser() {
    if (!formUser.username.trim()) { formError = 'Username required'; return; }
    if (editUser) {
      users = users.map(u => u.id === editUser!.id ? { ...u, ...formUser } : u);
    } else {
      const newUser: UserRow = { id: String(Date.now()), ...formUser, last_login: null };
      users = [...users, newUser];
    }
    showForm = false;
  }

  function deleteUser(id: string) {
    if (confirm('Delete this user?')) users = users.filter(u => u.id !== id);
  }

  function fmtDate(iso: string | null) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('th-TH', { month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' }); }
    catch { return iso; }
  }

  const cols = [
    { key:'username',     label:'Username',     sortable:true },
    { key:'display_name', label:'Display Name', sortable:true },
    { key:'role',         label:'Role', width:'100px',
      renderHtml: (v:unknown) => {
        const r = String(v);
        return `<span style="background:${roleColors[r]??'#8A8A8A'};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px">${r.toUpperCase()}</span>`;
      },
    },
    { key:'active',       label:'Active', width:'70px', align:'center' as const,
      renderHtml:(v:unknown)=>v?'<span style="color:var(--status-running);font-weight:700">●</span>':'<span style="color:var(--color-text-muted)">○</span>',
    },
    { key:'last_login',   label:'Last Login', width:'140px', format:(v:unknown)=>fmtDate(String(v)==='null'?null:String(v)) },
  ];
</script>

<svelte:head><title>Admin — EMH Dashboard</title></svelte:head>

<PageHeader title="Admin Panel" subtitle="User management and system settings" />

<div class="chart-card">
  <div class="adm-toolbar">
    <div class="card-title">Users</div>
    <button class="btn btn-solid btn-sm" onclick={openNew}>+ Add User</button>
  </div>

  <DataTable columns={cols} rows={users} rowKey={r => r.id} compact />

  <!-- Row actions (simplified — add to table via custom column in real use) -->
  <div class="row-actions-hint">Click a row to edit · Right-click to delete</div>
</div>

<!-- Modal form -->
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
          <input id="fu-username" class="input" type="text" bind:value={formUser.username} />
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
        <div class="fg">
          <label class="label">Active</label>
          <label class="toggle-row">
            <input type="checkbox" bind:checked={formUser.active} />
            <span>{formUser.active ? 'Active' : 'Inactive'}</span>
          </label>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-outline" onclick={() => (showForm = false)}>Cancel</button>
        <button class="btn btn-solid" onclick={saveUser}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .adm-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .card-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); }
  .row-actions-hint { font-size: 11px; color: var(--color-text-disabled); margin-top: 8px; text-align: right; }

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

  .toggle-row { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; margin-top: 4px; }

  .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
</style>
