<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import DataTable from '$lib/components/DataTable.svelte';

  interface StoreItem {
    id: string;
    part_no: string;
    description: string;
    category: string;
    qty_on_hand: number;
    min_qty: number;
    unit: string;
    location: string;
    last_issue: string | null;
  }

  let items = $state<StoreItem[]>([
    { id:'1', part_no:'KS-BH-001', description:'Bond Head Assembly K&S Iconn',   category:'Bond Head',  qty_on_hand:3,  min_qty:2, unit:'EA', location:'A-01', last_issue:'2026-05-28' },
    { id:'2', part_no:'KS-BH-002', description:'Bond Head Transducer',            category:'Bond Head',  qty_on_hand:8,  min_qty:5, unit:'EA', location:'A-02', last_issue:'2026-05-15' },
    { id:'3', part_no:'DA-DIS-001',description:'Dispenser Needle 22G',            category:'Dispenser',  qty_on_hand:50, min_qty:30,unit:'EA', location:'B-01', last_issue:'2026-06-01' },
    { id:'4', part_no:'DA-DIS-002',description:'Dispenser Syringe Barrel 5cc',    category:'Dispenser',  qty_on_hand:15, min_qty:10,unit:'EA', location:'B-02', last_issue:'2026-05-20' },
    { id:'5', part_no:'GEN-BELT-01','description':'Conveyor Belt 10mm wide',       category:'Conveyor',   qty_on_hand:12, min_qty:5, unit:'M',  location:'C-01', last_issue:'2026-04-10' },
    { id:'6', part_no:'GEN-FUSE-01','description':'Fuse 10A 250V',                category:'Electrical', qty_on_hand:100,min_qty:50,unit:'EA', location:'D-01', last_issue:'2026-06-02' },
    { id:'7', part_no:'SA-BLADE-01','description':'Saw Blade 200mm Diamond',       category:'Saw Blade',  qty_on_hand:6,  min_qty:4, unit:'EA', location:'E-01', last_issue:'2026-05-30' },
    { id:'8', part_no:'SA-BLADE-02','description':'Saw Blade 150mm Diamond',       category:'Saw Blade',  qty_on_hand:2,  min_qty:3, unit:'EA', location:'E-02', last_issue:'2026-06-01' },
    { id:'9', part_no:'GEN-OIL-01', 'description':'Machine Oil SAE 32',           category:'Lubricant',  qty_on_hand:20, min_qty:5, unit:'L',  location:'F-01', last_issue:'2026-05-25' },
  ]);

  let showLowStock = $state(false);

  const display = $derived(showLowStock ? items.filter(i => i.qty_on_hand <= i.min_qty) : items);

  const cols = [
    { key:'part_no',     label:'Part No',     sortable:true },
    { key:'description', label:'Description', sortable:true },
    { key:'category',    label:'Category',    width:'100px', sortable:true },
    { key:'qty_on_hand', label:'Qty',         width:'60px', align:'right' as const, sortable:true,
      renderHtml:(v:unknown, row:StoreItem) => {
        const n = Number(v);
        const c = n <= row.min_qty ? 'var(--status-down)' : n <= row.min_qty * 1.5 ? 'var(--status-waiting)' : 'inherit';
        return `<strong style="color:${c}">${n}</strong>`;
      },
    },
    { key:'min_qty',     label:'Min',         width:'55px', align:'right' as const, sortable:true },
    { key:'unit',        label:'Unit',        width:'50px' },
    { key:'location',    label:'Location',    width:'80px', sortable:true },
    { key:'last_issue',  label:'Last Issue',  width:'100px', sortable:true, format:(v:unknown): string=>String(v??'—') },
  ];
</script>

<svelte:head><title>Store Items — EMH Dashboard</title></svelte:head>

<PageHeader title="Store Items" subtitle="Spare parts and consumable inventory" />

<div class="chart-card">
  <div class="toolbar">
    <div class="card-title">Parts Inventory</div>
    <label class="toggle-row">
      <input type="checkbox" bind:checked={showLowStock} />
      <span>Show low stock only ({items.filter(i=>i.qty_on_hand<=i.min_qty).length})</span>
    </label>
    <button class="btn btn-solid btn-sm">+ Add Item</button>
  </div>

  <DataTable columns={cols} rows={display} rowKey={r => r.id} compact pageSize={20} />
</div>

<style>
  .toolbar { display:flex; align-items:center; gap:12px; margin-bottom:10px; }
  .card-title { font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-muted); flex:1; }
  .toggle-row { display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer; }
</style>
