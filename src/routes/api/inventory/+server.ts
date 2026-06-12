import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';
import type { InventoryKpi, InventoryMachine, HealthStatus, MachineArea } from '$types';

interface MwMachine {
  machine_id: string; des_machine: string; area: string; area_name?: string;
  mfg: string; model: string; sn: string;
  flag_key: number; flag_automotive: number; flag_gold: number;
  year_install?: number | null;
}
interface MwDowntime {
  code_machine: string; down_events: number; down_hrs: number; avg_mttr_min: number;
}
interface MwPackage {
  code_machine: string; package_type: string; last_run: string | null;
}

function health(hrs: number, events: number): HealthStatus {
  if (hrs >= 8)     return 'critical';
  if (hrs >= 2)     return 'warning';
  if (events >= 1)  return 'monitor';
  return 'healthy';
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const areas    = url.searchParams.get('areas')    ?? undefined;
    const key_only = url.searchParams.get('key_only') ?? undefined;
    const search   = url.searchParams.get('search')   ?? undefined;

    const [machineData, downtimeData, packageData] = await Promise.all([
      mwGet<{ machines: MwMachine[] }>('/api/v1/inventory/machines',
        { ...(areas ? { area: areas } : {}), ...(key_only ? { key_only } : {}) }),
      mwGet<{ rows: MwDowntime[] }>('/api/v1/inventory/downtime'),
      mwGet<{ packages: MwPackage[] }>('/api/v1/inventory/last-package')
        .catch(() => ({ packages: [] as MwPackage[] })),
    ]);

    const dtMap = new Map<string, MwDowntime>();
    for (const r of downtimeData.rows ?? []) dtMap.set(r.code_machine.trim(), r);

    const pkgMap = new Map<string, MwPackage>();
    for (const r of packageData.packages ?? []) pkgMap.set(r.code_machine.trim(), r);

    let machines: InventoryMachine[] = (machineData.machines ?? []).map(m => {
      const dt = dtMap.get(m.machine_id.trim());
      const down_events  = dt?.down_events  ?? 0;
      const down_hrs     = dt?.down_hrs     ?? 0;
      const avg_mttr_min = dt?.avg_mttr_min ?? 0;
      return {
        id: m.machine_id, code_machine: m.machine_id,
        des_machine:  m.des_machine   ?? '',
        area:         m.area as MachineArea,
        area_name:    m.area_name,
        model:        m.model         ?? '',
        manufacturer: m.mfg           ?? '',
        year_install: m.year_install   ?? null,
        serial_no:    m.sn            ?? null,
        is_key:       m.flag_key        === 1,
        is_auto:      m.flag_automotive === 1,
        is_gold:      m.flag_gold       === 1,
        status:       'Running',
        notes:        null,
        down_events, down_hrs, avg_mttr_min,
        health: health(down_hrs, down_events),
        last_package:  pkgMap.get(m.machine_id.trim())?.package_type  ?? null,
        last_run_date: pkgMap.get(m.machine_id.trim())?.last_run       ?? null,
      };
    });

    if (search) {
      const q = search.toLowerCase();
      machines = machines.filter(m =>
        m.code_machine.toLowerCase().includes(q)  ||
        m.des_machine.toLowerCase().includes(q)   ||
        m.model.toLowerCase().includes(q)         ||
        m.manufacturer.toLowerCase().includes(q)
      );
    }

    const kpi: InventoryKpi = {
      total_machines: machines.length,
      key_machines:   machines.filter(m => m.is_key).length,
      areas:          new Set(machines.map(m => m.area)).size,
      models:         new Set(machines.map(m => m.model).filter(Boolean)).size,
    };

    return apiResponse({ kpi, machines });
  } catch (err) {
    return apiError(err);
  }
};
